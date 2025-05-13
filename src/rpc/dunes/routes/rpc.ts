import { Router, Request, Response } from "express";
import { Models, ISetting } from "@/database/createConnection";

const router = Router();

/*
  Returns global Dune RPC settings

  Documentation: https://dunes.sh/docs/dunes-rpc/events#get-dunes-info
*/
router.get("/info", async (req: Request, res: Response) => {
  try {
    const { Setting } = req.db;

    const settings = (await Setting.findAll({
      raw: true,
      attributes: { exclude: ["id"] },
    })) as Omit<ISetting, "id">[];

    res.send(settings);
  } catch (e) {
    console.error(e);
    res.status(500).send({ error: "Internal server error" });
  }
});

export default router;
