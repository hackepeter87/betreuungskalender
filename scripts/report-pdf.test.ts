import assert from "node:assert/strict";
import test from "node:test";
import { jsPDF } from "jspdf";
import type { Table } from "jspdf-autotable";
import { createEmptyData } from "../src/data/defaults";
import { reportMessages } from "../src/i18n/reportMessages";
import { exportPdfReport } from "../src/lib/report";
import type { UnavailablePeriod } from "../src/types";

const timestamp = "2026-08-01T12:00:00.000Z";

for (const locale of ["de", "en"] as const) {
  for (const count of [0, 1, 40]) {
    test(`PDF unavailability rows remain below wrapped headers (${locale}, ${count} records)`, async () => {
      const data = createEmptyData();
      data.updatedAt = timestamp;
      data.unavailablePeriods = Array.from({ length: count }, (_, index): UnavailablePeriod => ({
        id: `test-unavailable-${index}`,
        startDateTime: "2026-08-01T08:00:00.000Z",
        endDateTime: "2026-08-01T18:00:00.000Z",
        scope: "own_unavailability",
        childIds: [],
        category: "other",
        dutyRelated: true,
        affectsContact: true,
        affectsHolidays: false,
        hasEvidence: false,
        notes: `Fictional review record ${index}. Long text verifies wrapping without losing the record.`,
        createdBy: "test-actor",
        updatedBy: "test-actor",
        createdAt: timestamp,
        updatedAt: timestamp
      }));
      const before = structuredClone(data);
      let document: (jsPDF & { lastAutoTable: Table }) | undefined;
      const originalSave = jsPDF.API.save;
      jsPDF.API.save = function (this: jsPDF & { lastAutoTable: Table }) {
        document = this;
        return this;
      };
      try {
        await exportPdfReport(data, "2026-08-01", "2026-08-31", {
          reportId: "BK-FICTIONAL-REVIEW",
          includeAuditHistory: false,
          createdAt: timestamp,
          locale
        });
      } finally {
        jsPDF.API.save = originalSave;
      }
      assert.ok(document);
      const pdf = document.output();
      assert.ok(pdf.startsWith("%PDF-"));
      assert.ok(pdf.includes("BK-FICTIONAL-REVIEW"));
      assert.deepEqual(data, before, "PDF generation must not mutate the report snapshot");
      const table = document.lastAutoTable;
      if (!count) {
        const textBlock = pdf.match(/BT\n[\s\S]*?ET/g)?.find((block) => block.includes(reportMessages[locale].noUnavailable));
        assert.ok(textBlock, "empty-state text must be emitted into the PDF");
        const position = textBlock.match(/([\d.]+) ([\d.]+) Td/);
        assert.ok(position);
        const baseline = document.internal.pageSize.getHeight() - Number(position[2]) / document.internal.scaleFactor;
        const header = table.head[0].cells[0];
        assert.ok(baseline - 2.5 >= header.y + header.height, "actual PDF text must clear the header with room for glyphs");
      }
      assert.equal(table.body.length, Math.max(1, count));
      assert.ok(table.head[0].height > 5, "exercise wrapped table headings");
      for (const row of table.body) {
        for (const cell of Object.values(row.cells)) {
          assert.ok(cell.y >= 14 + table.head[0].height, "row must clear the repeated header");
          assert.ok(cell.y + cell.height < 280, "row must clear the page footer");
        }
      }
      if (!count) {
        const cell = table.body[0].cells[0];
        const header = table.head[0].cells[0];
        assert.ok(cell.y >= header.y + header.height, "empty text must follow the complete header");
        assert.equal(cell.colSpan, 10);
        assert.deepEqual(cell.text, [reportMessages[locale].noUnavailable]);
        assert.equal(pdf.split(reportMessages[locale].noUnavailable).length - 1, 1);
        assert.equal(document.getNumberOfPages(), 2);
      } else {
        assert.ok(!pdf.includes(reportMessages[locale].noUnavailable));
      }
      if (count === 40) assert.ok(table.pageNumber > 1, "exercise table page breaks");
      for (let page = 1; page <= document.getNumberOfPages(); page++) {
        assert.ok(pdf.includes(`(${reportMessages[locale].page} ${page})`));
      }
    });
  }
}
