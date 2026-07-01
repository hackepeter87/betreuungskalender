import { z } from "zod";
import { careScopes, unavailableCategories } from "../../shared/api.js";

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Ungültiges Datum oder ungültige Uhrzeit."
});

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Datum muss im Format JJJJ-MM-TT angegeben werden."
});

const childIds = z.array(z.string().min(1)).min(1, "Mindestens ein Kind ist erforderlich.");

export const childInputSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(200),
  birthMonth: z.number().int().min(1).max(12),
  birthYear: z.number().int().min(1900).max(2200),
  color: z.string().trim().min(1).max(50)
});

export const tripInputSchema = z.object({
  id: z.string().min(1).optional(),
  purpose: z.string().trim().min(1, "Fahrtzweck ist erforderlich.").max(200),
  km: z.number().finite().positive("Kilometer müssen größer als 0 sein."),
  ownCar: z.boolean().default(true),
  reimbursed: z.boolean().default(false),
  reimbursementAmount: z.number().finite().nonnegative().optional(),
  notes: z.string().trim().max(4000).optional()
});

export const costInputSchema = z.object({
  id: z.string().min(1).optional(),
  category: z.string().trim().min(1, "Kostenkategorie ist erforderlich.").max(100),
  amount: z.number().finite().positive("Betrag muss größer als 0 sein."),
  paidBy: z.string().trim().min(1, "Zahler ist erforderlich.").max(100),
  notes: z.string().trim().max(4000).optional()
});

export const careEntryInputSchema = z
  .object({
    startDateTime: isoDateTime,
    endDateTime: isoDateTime,
    childIds,
    generatedByPatternId: z.string().trim().min(1).max(200).optional(),
    ruleOccurrenceDate: dateKey.optional(),
    contactRuleId: z.string().trim().min(1).max(200).optional(),
    contactRuleSegmentId: z.string().trim().min(1).max(200).optional(),
    contactRuleOccurrenceKey: z.string().trim().min(1).max(200).optional(),
    responsiblePartyId: z.string().trim().min(1).max(200).optional(),
    contactRuleSyncState: z.enum(["generated", "manual_override"]).optional(),
    status: z.enum(["planned", "completed", "cancelled"]),
    careScope: z.enum(careScopes).default("hourly"),
    cancellationReason: z.string().trim().max(4000).optional(),
    overnight: z.boolean().default(false),
    schoolHandover: z.boolean().default(false),
    holiday: z.boolean().default(false),
    weekend: z.boolean().default(false),
    additionalCare: z.boolean().default(false),
    location: z.string().trim().max(200).optional(),
    customLocation: z.string().trim().max(500).optional(),
    handoverFrom: z.string().trim().max(200).optional(),
    handoverTo: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(10000).optional(),
    evidenceReference: z.string().trim().max(2000).optional(),
    hasEvidence: z.boolean().default(false),
    trips: z.array(tripInputSchema).default([]),
    costs: z.array(costInputSchema).default([])
  })
  .superRefine((entry, context) => {
    const start = Date.parse(entry.startDateTime);
    const end = Date.parse(entry.endDateTime);
    if (end <= start) {
      context.addIssue({
        code: "custom",
        path: ["endDateTime"],
        message: "Das Ende muss nach dem Beginn liegen."
      });
    }
    if (entry.status === "cancelled" && !entry.cancellationReason?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["cancellationReason"],
        message: "Ein ausgefallener Termin benötigt einen Ausfallgrund."
      });
    }
  });

export const holidayInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    startDate: dateKey,
    endDate: dateKey,
    childIds,
    assignedTo: z.enum(["father", "mother", "shared"]),
    notes: z.string().trim().max(4000).optional()
  })
  .refine((period) => period.endDate >= period.startDate, {
    path: ["endDate"],
    message: "Das Ende darf nicht vor dem Beginn liegen."
  });

export const contactPatternInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    startDate: dateKey,
    frequency: z.literal("biweekly").default("biweekly"),
    fridayStartTime: z.string().regex(/^\d{2}:\d{2}$/),
    sundayEndTime: z.string().regex(/^\d{2}:\d{2}$/),
    childIds,
    active: z.boolean().default(true)
  })
  .refine((pattern) => {
    const [year, month, day] = pattern.startDate.split("-").map(Number);
    return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay() === 5;
  }, {
    path: ["startDate"],
    message: "Das Startdatum einer 14-Tage-Regel muss ein Freitag sein."
  });

const contactRuleWeekdaySchema = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

const contactRuleRecurrenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("weekly"),
    intervalWeeks: z.number().int().min(1).max(12),
    weekdays: z.array(contactRuleWeekdaySchema).min(1).max(7)
  }),
  z.object({
    kind: z.literal("monthlyByWeekday"),
    intervalMonths: z.number().int().min(1).max(12),
    ordinals: z.array(z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(-1)
    ])).min(1).max(5),
    weekdays: z.array(contactRuleWeekdaySchema).min(1).max(7)
  })
]);

const contactRuleSegmentSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    startDayOffset: z.number().int().min(0).max(30),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endDayOffset: z.number().int().min(0).max(30),
    endTime: z.string().regex(/^\d{2}:\d{2}$/)
  })
  .refine((segment) => {
    if (segment.endDayOffset > segment.startDayOffset) return true;
    return segment.endDayOffset === segment.startDayOffset && segment.endTime > segment.startTime;
  }, {
    path: ["endTime"],
    message: "Das Ende der Zeitspanne muss nach dem Beginn liegen."
  });

export const contactRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    startDate: dateKey,
    endDate: dateKey.optional(),
    timezone: z.literal("Europe/Berlin").default("Europe/Berlin"),
    recurrence: contactRuleRecurrenceSchema,
    segments: z.array(contactRuleSegmentSchema).min(1).max(8),
    syncHorizonMonths: z.number().int().min(1).max(36).default(12),
    responsiblePartyId: z.string().trim().min(1).max(200).optional(),
    childIds,
    active: z.boolean().default(true)
  })
  .refine((rule) => !rule.endDate || rule.endDate >= rule.startDate, {
    path: ["endDate"],
    message: "Das Ende darf nicht vor dem Beginn liegen."
  });

export const settingsInputSchema = z.record(z.string(), z.unknown());

export const monthlyClosingInputSchema = z.object({
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
  dataUpdatedAt: isoDateTime,
  summary: z.record(z.string(), z.unknown())
});

export const appDataImportSchema = z.object({
  schemaVersion: z.number().int(),
  children: z.array(z.record(z.string(), z.unknown())),
  entries: z.array(z.record(z.string(), z.unknown())),
  holidayPeriods: z.array(z.record(z.string(), z.unknown())).default([]),
  unavailablePeriods: z.array(z.record(z.string(), z.unknown())).default([]),
  externalCalendarSources: z.array(z.record(z.string(), z.unknown())).default([]),
  externalCalendarEvents: z.array(z.record(z.string(), z.unknown())).default([]),
  contactPatterns: z.array(z.record(z.string(), z.unknown())).default([]),
  contactRules: z.array(z.record(z.string(), z.unknown())).default([]),
  auditLog: z.array(z.record(z.string(), z.unknown())).default([]),
  monthClosures: z.array(z.record(z.string(), z.unknown())).default([]),
  lastJsonBackupAt: z.string().optional(),
  settings: z.record(z.string(), z.unknown()),
  updatedAt: isoDateTime
});

export const unavailablePeriodInputSchema = z
  .object({
    startDateTime: isoDateTime,
    endDateTime: isoDateTime,
    category: z.enum(unavailableCategories),
    dutyRelated: z.boolean().default(false),
    affectsContact: z.boolean().default(false),
    affectsHolidays: z.boolean().default(false),
    location: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(10000).optional(),
    hasEvidence: z.boolean().default(false),
    evidenceReference: z.string().trim().max(2000).optional()
  })
  .refine(
    (period) => Date.parse(period.endDateTime) > Date.parse(period.startDateTime),
    {
      path: ["endDateTime"],
      message: "Das Ende muss nach dem Beginn liegen."
    }
  );

export const externalCalendarImportSchema = z.object({
  name: z.string().trim().min(1).max(200),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  content: z.string().min(1).max(1_000_000)
});

export const externalCalendarUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    visible: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0);

export function unavailablePeriodWarnings(input: {
  category: string;
  dutyRelated: boolean;
  notes?: string;
  evidenceReference?: string;
}): string[] {
  const warnings: string[] = [];
  if (input.category === "other" && !input.notes?.trim()) {
    warnings.push("Bei der Kategorie Sonstiges wird eine Notiz empfohlen.");
  }
  if (input.dutyRelated && !input.evidenceReference?.trim()) {
    warnings.push(
      "Bei dienstlich veranlasster Nichtverfügbarkeit wird eine Belegreferenz empfohlen."
    );
  }
  return warnings;
}
