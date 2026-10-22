import { MongoClient } from "mongodb";
import type { Response, Session, Survey, User, Version } from "./models.js";
export async function connectDatabase(uri: string) {
  const client = new MongoClient(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const hello = await client.db().admin().command({ hello: 1 });
  if (!hello.setName) {
    await client.close();
    throw new Error("本项目需要 MongoDB 副本集，请先执行 npm run db:start");
  }
  const db = client.db();
  return {
    client,
    db,
    users: db.collection<User>("users"),
    sessions: db.collection<Session>("sessions"),
    surveys: db.collection<Survey>("surveys"),
    versions: db.collection<Version>("survey_versions"),
    responses: db.collection<Response>("responses"),
  };
}
export type Database = Awaited<ReturnType<typeof connectDatabase>>;
