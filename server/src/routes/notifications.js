import { Router } from "express";
import db from "../db.js";
import { ok, fail, asyncHandler } from "../utils/response.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(req.user.id);
    const unreadCount = db
      .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0")
      .get(req.user.id).c;
    ok(res, { notifications: rows, unreadCount });
  })
);

router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const n = db.prepare("SELECT * FROM notifications WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!n) return fail(res, "Notification not found.", 404);
    db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(n.id);
    ok(res, { read: true });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").run(req.user.id);
    ok(res, { read: true });
  })
);

export default router;
