import { Router } from "express";
import { legacyUserSelect, requireAuth, safeUser } from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { validateName } from "./auth.js";
import { attachPasswordPolicyStatus } from "../lib/password-policy.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get("/me", attachPasswordPolicyStatus, (_req, res) => {
  res.json({ ...safeUser(res.locals.auth.user), passwordPolicy: res.locals.passwordPolicy });
});
usersRouter.patch(
  "/me",
  asyncRoute(async (req, res) => {
    const data = bodyObject(req.body, ["name"]);
    if (!("name" in data))
      throw new HttpError(400, "INVALID_INPUT", "Name is required.");
    const user = await prismaPg.user.update({
      where: { id: res.locals.auth.user.id },
      data: { name: validateName(data.name) },
      select: legacyUserSelect,
    });
    res.json(safeUser(user));
  }),
);
