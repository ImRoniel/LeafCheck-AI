import { PrismaClient } from "../generated/auth-read-client/index.js";
import "./env.js";

// This module exposes only reads. Supabase exclusively owns writes to auth.*.
let client: PrismaClient | undefined;
function readClient() {
  return (client ??= new PrismaClient({ log: [] }));
}
export const authRead = {
  session: (id: string) => readClient().providerSession.findUnique({ where: { id } }),
  sessions: (userId: string) => readClient().providerSession.findMany({ where: { userId } }),
  user: (id: string) => readClient().providerUser.findUnique({ where: { id } }),
  usersByEmail: (email: string) => readClient().providerUser.findMany({ where: { email: { equals: email, mode: "insensitive" } } }),
  disconnect: async () => { await client?.$disconnect(); },
};
