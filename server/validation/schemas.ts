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
    status: z.enum(["planned", "completed", "cancelled"]),
    careScope: z.enum(careScopes).default("hourly"),
    cancellationReason: z.string().trim().max(4000).optional(),
    overnight: z.boolean().default(false),
    schoolHandover: z.boolean().default(false),
    holiday: z.boolean().default(false),
    weekend: z.boolean().default(false),
    additionalCare: z.boolean().default(false),
    location: z.string().trim().max(200).optional(),
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

export const settingsInputSchema = z.record(z.string(), z.unknown());

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
