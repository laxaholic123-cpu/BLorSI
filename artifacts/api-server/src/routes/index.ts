import { Router, type IRouter } from "express";
import healthRouter from "./health";
import boardScanRouter from "./board-scan";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/board-scan", boardScanRouter);

export default router;
