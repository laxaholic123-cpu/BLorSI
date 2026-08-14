import { Router, type IRouter } from "express";

export interface HealthCheckResponse {
  status: string;
}

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data: HealthCheckResponse = { status: "ok" };
  res.json(data);
});

export default router;
