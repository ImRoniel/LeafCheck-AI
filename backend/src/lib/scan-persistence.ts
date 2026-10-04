import type { Prisma, PrismaClient } from "../generated/postgres-client/index.js";
import type { CareTaskOutput, GeminiStructuredOutput } from "../types/scan.js";
import { HttpError } from "./http.js";
import { validateScanOutput } from "./scan-output.js";

export interface ScanPersistenceInput {
  userId: string;
  plantId?: string;
  name: string;
  species: string;
  location?: string;
  scanTime: Date;
  output: GeminiStructuredOutput;
  identification: Omit<Prisma.PlantIdentificationUncheckedCreateInput, "plantId">;
  telemetrySnapshot?: Prisma.InputJsonValue;
  idealSpecs?: Prisma.InputJsonValue;
}

/** All scan-owned relational writes commit together; providers run before this. */
export async function persistScan(client: Pick<PrismaClient, "$transaction">, input: ScanPersistenceInput) {
  validateScanOutput(input.output);
  return client.$transaction(async (tx) => {
    const select = { id: true, name: true, species: true, deviceId: true } as const;
    const plant = input.plantId
      ? await tx.plant.findFirst({ where: { id: input.plantId, userId: input.userId }, select })
      : await tx.plant.create({ data: {
        name: input.name, species: input.species, location: input.location,
        userId: input.userId, healthStatus: "unknown", lastScannedAt: input.scanTime,
      }, select });
    if (!plant) throw new HttpError(404, "NOT_FOUND", "Plant not found.");

    await tx.plantIdentification.create({ data: { ...input.identification, plantId: plant.id } });
    const analysis = await tx.aIAnalysis.create({ data: {
      plantId: plant.id, userId: input.userId, healthStatus: input.output.healthStatus,
      diagnoses: [], recommendations: [], rawAnalysisText: input.output.diagnosticReport,
      speciesName: input.species, telemetrySnapshot: input.telemetrySnapshot, idealSpecs: input.idealSpecs,
      notificationTime: new Date(input.output.notification.notifyAt),
      notificationReason: input.output.notification.reason, isArchived: true, archivedAt: input.scanTime,
    } });
    const careTasks: CareTaskOutput[] = [];
    // At most five tasks; individual inserts keep report order and return the
    // actual saved fields, without relying on bulk-insert return ordering.
    for (const task of input.output.careTasks) {
      const saved = await tx.careTask.create({ data: {
        plantId: plant.id, userId: input.userId, analysisId: analysis.id,
        title: task.title, taskType: task.taskType, description: task.description,
        urgency: task.urgency, status: "PENDING", dueDate: new Date(task.dueDate),
      } });
      const urgency = saved.urgency;
      if (urgency !== "routine" && urgency !== "immediate" && urgency !== "urgent") {
        throw new HttpError(502, "SCAN_AI_UNAVAILABLE", "We couldn't complete your plant analysis. Please try again later.");
      }
      careTasks.push({ title: saved.title, taskType: saved.taskType,
        description: saved.description ?? "", urgency,
        dueDate: saved.dueDate.toISOString() });
    }
    await tx.plant.update({ where: { id: plant.id, userId: input.userId }, data: {
      healthStatus: input.output.healthStatus, lastScannedAt: input.scanTime, species: input.species,
    } });
    return { plant, analysis, careTasks };
  });
}
