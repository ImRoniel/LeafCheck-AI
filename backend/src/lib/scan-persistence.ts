import type { Prisma, PrismaClient } from "../generated/postgres-client/index.js";
import type { CareTaskOutput, GeminiStructuredOutput } from "../types/scan.js";
import { HttpError } from "./http.js";
import { validateScanOutput } from "./scan-output.js";
import { pairPlantDeviceInTransaction } from "./plant-pairing.js";
import { isPairingConflict, serializableTransaction } from "./serializable.js";

export interface ScanPersistenceInput {
  userId: string;
  plantId?: string;
  name: string;
  species: string;
  location?: string;
  imageUrl?: string;
  deviceId?: string;
  scanTime: Date;
  output: GeminiStructuredOutput | null;
  diagnosisFailure?: { code: string; message: string };
  identification: Omit<Prisma.PlantIdentificationUncheckedCreateInput, "plantId">;
  telemetrySnapshot?: Prisma.InputJsonValue;
  idealSpecs?: Prisma.InputJsonValue;
}

/** All scan-owned relational writes commit together; providers run before this. */
export async function persistScan(client: Pick<PrismaClient, "$transaction">, input: ScanPersistenceInput) {
  if (input.output === null) {
    if (!input.diagnosisFailure) throw new HttpError(400, "INVALID_INPUT", "A diagnosis failure must be explicit.");
  } else validateScanOutput(input.output);
  if (input.output && input.output.subjectKind !== "living_plant") {
    throw new HttpError(400, "INVALID_INPUT", "Only living plant scans can be saved.");
  }
  return serializableTransaction(client, async (tx) => {
    const select = { id: true, name: true, species: true, deviceId: true, healthStatus: true } as const;
    let plant = input.plantId
      ? await tx.plant.findFirst({ where: { id: input.plantId, userId: input.userId }, select })
      : await tx.plant.create({ data: {
        name: input.name, species: input.species, location: input.location, imageUrl: input.imageUrl,
        userId: input.userId, healthStatus: "unknown", lastScannedAt: input.scanTime,
      }, select });
    if (!plant) throw new HttpError(404, "NOT_FOUND", "Plant not found.");
    if (!input.plantId && input.deviceId !== undefined) {
      const paired = await pairPlantDeviceInTransaction(tx, plant.id, input.userId, input.deviceId);
      plant = { ...plant, deviceId: paired.plant.deviceId };
    }
    // An unsuccessful diagnosis cannot downgrade an existing health assessment.
    const healthStatus = input.output?.healthStatus ?? plant.healthStatus ?? "unknown";

    await tx.plantIdentification.create({ data: { ...input.identification, plantId: plant.id } });
    const analysis = await tx.aIAnalysis.create({ data: {
      plantId: plant.id, userId: input.userId, healthStatus,
      diagnoses: [], recommendations: [], rawAnalysisText: input.output?.diagnosticReport ?? null,
      speciesName: input.species, telemetrySnapshot: input.telemetrySnapshot, idealSpecs: input.idealSpecs,
      notificationTime: input.output ? new Date(input.output.notification!.notifyAt) : null,
      notificationReason: input.output?.notification?.reason ?? null, isArchived: true, archivedAt: input.scanTime,
    } });
    const careTasks: CareTaskOutput[] = [];
    // At most five tasks; individual inserts keep report order and return the
    // actual saved fields, without relying on bulk-insert return ordering.
    for (const task of input.output?.careTasks ?? []) {
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
      ...(input.output ? { healthStatus } : {}), lastScannedAt: input.scanTime, species: input.species,
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
    } });
    return { plant, analysis, careTasks, healthStatus };
  }, isPairingConflict);
}
