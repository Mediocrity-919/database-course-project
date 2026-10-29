import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BSON, MongoClient } from "mongodb";
import { config } from "../apps/server/src/config.js";
const cfg = config(),
  client = new MongoClient(cfg.uri);
await client.connect();
const dir = resolve(
  ".local/backups",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(dir, { recursive: true });
const session = client.startSession();
try {
  const names = (await client.db().listCollections().toArray()).map(
    (x) => x.name,
  );
  const data: Record<string, unknown[]> = {};
  await session.withTransaction(
    async () => {
      for (const name of names)
        data[name] = await client
          .db()
          .collection(name)
          .find({}, { session })
          .toArray();
    },
    { readConcern: { level: "snapshot" } },
  );
  for (const [name, rows] of Object.entries(data))
    writeFileSync(
      resolve(dir, `${name}.json`),
      BSON.EJSON.stringify(rows, { relaxed: false }),
    );
  writeFileSync(
    resolve(dir, "manifest.json"),
    JSON.stringify(
      {
        database: client.db().databaseName,
        counts: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v.length]),
        ),
      },
      null,
      2,
    ),
  );
  console.log("逻辑备份已写入（含敏感数据，仅本地保管）：", dir);
} finally {
  await session.endSession();
  await client.close();
}
