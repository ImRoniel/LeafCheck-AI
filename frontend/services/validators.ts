import type { AIDiagnosisResponse, Plant, PlantHealthUpdate, ScanResponse, TelemetryHistory, TelemetryPayload } from "../types";
import { ApiError } from "./errors";
type Check = (value: unknown, path: string) => void;
const fail = (path: string): never => { throw new ApiError("validation", `Invalid API value at ${path}`); };
export const text: Check = (v,p) => { if(typeof v !== "string") fail(p); };
export const nonempty: Check = (v,p) => { text(v,p); if(!(v as string).trim()) fail(p); };
const number: Check = (v,p) => { if(typeof v !== "number" || !Number.isFinite(v)) fail(p); };
const range = (min: number, max = Infinity): Check => (v,p) => { number(v,p); if((v as number)<min || (v as number)>max) fail(p); };
const integer = (min: number, max = Infinity): Check => (v,p) => { range(min,max)(v,p); if(!Number.isInteger(v)) fail(p); };
const boolean: Check = (v,p) => { if(typeof v !== "boolean") fail(p); };
const date: Check = (v,p) => { nonempty(v,p); if(!/^\d{4}-\d{2}-\d{2}T/.test(v as string) || !Number.isFinite(Date.parse(v as string))) fail(p); };
const enumeration = (...values: unknown[]): Check => (v,p) => { if(!values.includes(v)) fail(p); };
export const health = enumeration("healthy","warning","critical","unknown");
const optional = (check: Check): Check => (v,p) => { if(v !== undefined) check(v,p); };
const nullable = (check: Check): Check => (v,p) => { if(v !== null) check(v,p); };
const array = (check: Check): Check => (v,p) => { if(!Array.isArray(v)) fail(p); (v as unknown[]).forEach((x,i)=>check(x,`${p}[${i}]`)); };
export const object = (shape: Record<string,Check>): Check => (v,p) => {
  if(!v || typeof v !== "object" || Array.isArray(v)) fail(p);
  for(const [key,check] of Object.entries(shape)) check((v as Record<string,unknown>)[key],`${p}.${key}`);
};
const diagnosis = object({ diseaseName: text, confidence: range(0,1), severity: enumeration("low","moderate","high","severe"), symptoms: array(text), description: text, affectedAreaPercentage: optional(range(0,100)) });
const recommendation = object({ action: text, urgency: enumeration("routine","immediate","urgent"), details: text, wateringAdjustments: optional(text), lightAdjustments: optional(text) });
const plant = object({id:nonempty,name:text,species:text,location:optional(text),healthStatus:health,lastScannedAt:optional(date),imageUrl:optional(text),createdAt:date,updatedAt:date,diagnoses:optional(array(diagnosis)),recommendations:optional(array(recommendation))});
export const telemetryCheck = object({deviceId:nonempty,timestamp:date,soilMoisture:object({percentage:range(0,100),rawAnalogValue:integer(0),status:enumeration("optimal","dry","overwatered")}),lightLevel:object({lux:range(0),status:enumeration("insufficient","optimal","excessive")}),environment:object({temperatureCelsius:number,humidityPercentage:range(0,100)})});
const snapshot = {temperature:number,humidity:range(0,100),soilMoisture:range(0,100),lightLevel:nullable(range(0)),timestamp:date};
const history = object({data:array(object({...snapshot,id:nonempty,deviceId:nonempty,soilMoistureRaw:nullable(integer(0))})),pagination:object({total:integer(0),limit:integer(1,200),offset:integer(0),hasMore:boolean})});
function parse<T>(check: Check) { return (v: unknown): T => { check(v,"response"); return v as T; }; }
export const parsePlant = parse<Plant>(plant);
export const parsePlants = parse<Plant[]>(array(plant));
export const parseTelemetry = parse<TelemetryPayload>(telemetryCheck);
export const parseHistory = (v: unknown): TelemetryHistory => {
  const value = parse<TelemetryHistory>(history)(v); const {total,limit,offset,hasMore} = value.pagination;
  if(value.data.length>limit || value.data.length>Math.max(0,total-offset) || hasMore !== (offset+limit<total)) fail("response.pagination");
  return value;
};
export const parseHealth = parse<PlantHealthUpdate>(object({id:nonempty,healthStatus:health}));
export const parseAnalysis = parse<AIDiagnosisResponse>(object({success:enumeration(true),healthStatus:health,diagnoses:array(diagnosis),recommendations:array(recommendation),rawAnalysisText:optional(text),timestamp:date,error:optional(text)}));
export const parseScan = parse<ScanResponse>(object({success:enumeration(true),identification:object({speciesName:nonempty,commonName:nullable(text),confidence:range(0,1)}),diagnostic:object({id:nonempty,healthStatus:health,rawAnalysisText:text,telemetryFreshness:text}),telemetry:nullable(object(snapshot))}));
