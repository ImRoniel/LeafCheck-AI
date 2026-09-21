import { Router } from "express";
import { requireAuth, safeUser } from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { validateName } from "./auth.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get("/me", (_req, res) => {
  res.json(safeUser(res.locals.auth.user));
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
    });
    res.json(safeUser(user));
  }),
);
