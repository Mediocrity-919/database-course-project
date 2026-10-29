import type { Db, Document } from "mongodb";
const str = { bsonType: "string" };
const date = { bsonType: "date" };
const oid = { bsonType: "objectId" };
const nullableDate = { bsonType: ["date", "null"] };
const integer = {
  bsonType: ["int", "long", "double"],
  minimum: 0,
  multipleOf: 1,
};
const number = { bsonType: ["int", "long", "double", "decimal"] };
const obj = (required: string[], properties: Document): Document => ({
  bsonType: "object",
  required,
  properties,
});
const settings = obj(
  ["allowAnonymous", "allowMultipleSubmissions", "allowEditAfterSubmission"],
  {
    allowAnonymous: { bsonType: "bool" },
    allowMultipleSubmissions: { bsonType: "bool" },
    allowEditAfterSubmission: { bsonType: "bool" },
    shareLibraryStatistics: { bsonType: "bool" },
  },
);
const action = obj(["action"], {
  action: { enum: ["next", "goto", "end"] },
  targetQuestionId: str,
});
const question = obj(
  ["id", "order", "type", "title", "required", "validation", "logic"],
  {
    id: str,
    source: obj(["familyId", "versionId"], {
      familyId: { bsonType: "string", pattern: "^[a-fA-F0-9]{24}$" },
      versionId: { bsonType: "string", pattern: "^[a-fA-F0-9]{24}$" },
    }),
    order: integer,
    type: { enum: ["single_choice", "multiple_choice", "text", "number"] },
    title: { bsonType: "string", minLength: 1, maxLength: 500 },
    description: str,
    required: { bsonType: "bool" },
    options: {
      bsonType: "array",
      maxItems: 50,
      items: obj(["id", "label", "order"], {
        id: str,
        label: str,
        order: integer,
      }),
    },
    validation: { bsonType: "object" },
    logic: obj(["matchMode", "rules", "defaultAction"], {
      matchMode: { enum: ["first_match"] },
      defaultAction: action,
      rules: {
        bsonType: "array",
        maxItems: 20,
        items: obj(["id", "priority", "when", "then"], {
          id: str,
          priority: integer,
          when: obj(["operator", "value"], {
            operator: {
              enum: [
                "eq",
                "contains_any",
                "contains_all",
                "equals_set",
                "gt",
                "gte",
                "lt",
                "lte",
                "between",
              ],
            },
          }),
          then: action,
        }),
      },
    }),
  },
);
const definition = obj(["title", "description", "settings", "questions"], {
  title: { bsonType: "string", minLength: 1, maxLength: 100 },
  description: { bsonType: "string", maxLength: 2000 },
  settings,
  questions: { bsonType: "array", maxItems: 100, items: question },
});
const answers = {
  bsonType: "array",
  maxItems: 100,
  items: {
    oneOf: [
      obj(["questionId", "questionType", "value"], {
        questionId: str,
        questionType: { enum: ["single_choice", "text"] },
        value: { bsonType: "string", maxLength: 2000 },
      }),
      obj(["questionId", "questionType", "value"], {
        questionId: str,
        questionType: { enum: ["multiple_choice"] },
        value: {
          bsonType: "array",
          maxItems: 50,
          uniqueItems: true,
          items: str,
        },
      }),
      obj(["questionId", "questionType", "value"], {
        questionId: str,
        questionType: { enum: ["number"] },
        value: number,
      }),
    ],
  },
};
const base = { _id: oid, schemaVersion: { enum: [1] } };
export const validators: Record<string, Document> = {
  users: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "username",
        "usernameNormalized",
        "passwordHash",
        "createdAt",
        "updatedAt",
      ],
      {
        ...base,
        username: str,
        usernameNormalized: str,
        passwordHash: str,
        createdAt: date,
        updatedAt: date,
      },
    ),
  },
  sessions: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "tokenHash",
        "userId",
        "csrfToken",
        "createdAt",
        "expiresAt",
      ],
      {
        ...base,
        tokenHash: str,
        userId: oid,
        csrfToken: str,
        createdAt: date,
        expiresAt: date,
      },
    ),
  },
  surveys: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "ownerId",
        "publicId",
        "title",
        "status",
        "deadlineAt",
        "draft",
        "activeVersionId",
        "revision",
        "submissionGateSeq",
        "createdAt",
        "updatedAt",
      ],
      {
        ...base,
        ownerId: oid,
        publicId: str,
        title: str,
        status: { enum: ["draft", "published", "closed"] },
        deadlineAt: nullableDate,
        draft: { ...definition, bsonType: ["object", "null"] },
        activeVersionId: { bsonType: ["objectId", "null"] },
        activeVersionNumber: integer,
        revision: integer,
        submissionGateSeq: integer,
        createdAt: date,
        updatedAt: date,
        publishedAt: nullableDate,
        closedAt: nullableDate,
      },
    ),
  },
  survey_versions: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "surveyId",
        "versionNumber",
        "sourceDraftRevision",
        "definition",
        "createdBy",
        "publishedAt",
      ],
      {
        ...base,
        surveyId: oid,
        versionNumber: { ...integer, minimum: 1 },
        sourceDraftRevision: integer,
        definition,
        createdBy: oid,
        publishedAt: date,
      },
    ),
  },
  responses: {
    $and: [
      {
        $jsonSchema: obj(
          [
            "_id",
            "schemaVersion",
            "surveyId",
            "surveyVersionId",
            "participantKey",
            "clientAttemptId",
            "status",
            "isAnonymous",
            "respondentId",
            "repeatAllowed",
            "answers",
            "visitedQuestionIds",
            "revision",
            "submissionHash",
            "editDraft",
            "editCount",
            "startedAt",
            "updatedAt",
            "acceptedAt",
            "submittedAt",
          ],
          {
            ...base,
            surveyId: oid,
            surveyVersionId: oid,
            participantKey: str,
            clientAttemptId: str,
            status: { enum: ["in_progress", "submitted"] },
            isAnonymous: { bsonType: "bool" },
            respondentId: { bsonType: ["objectId", "null"] },
            repeatAllowed: { bsonType: "bool" },
            answers,
            visitedQuestionIds: {
              bsonType: "array",
              uniqueItems: true,
              items: str,
            },
            revision: integer,
            submissionHash: { bsonType: ["string", "null"] },
            lastSubmissionId: { bsonType: ["string", "null"] },
            editDraft: {
              ...obj(["answers"], { answers }),
              bsonType: ["object", "null"],
            },
            editCount: integer,
            startedAt: date,
            updatedAt: date,
            acceptedAt: nullableDate,
            submittedAt: nullableDate,
            lastSubmittedAt: nullableDate,
          },
        ),
      },
      {
        $or: [
          { isAnonymous: true, respondentId: null },
          { isAnonymous: false, respondentId: { $type: "objectId" } },
        ],
      },
      {
        $or: [
          { status: "in_progress", submittedAt: null },
          {
            status: "submitted",
            submittedAt: { $type: "date" },
            submissionHash: { $type: "string" },
            lastSubmissionId: { $type: "string" },
          },
        ],
      },
    ],
  },
};
// A reusable library item is context free: it never carries a source pointer,
// is always stored at order 1 and has no survey-specific jump rules.
const libraryQuestion = {
  ...question,
  not: { required: ["source"] },
  properties: {
    ...question.properties,
    order: { ...integer, minimum: 1, maximum: 1 },
    logic: obj(["matchMode", "rules", "defaultAction"], {
      matchMode: { enum: ["first_match"] },
      rules: { bsonType: "array", maxItems: 0 },
      defaultAction: obj(["action"], { action: { enum: ["next"] } }),
    }),
  },
};
const oidArray = (max: number) => ({
  bsonType: "array",
  maxItems: max,
  uniqueItems: true,
  items: oid,
});
Object.assign(validators, {
  question_banks: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "ownerId",
        "name",
        "description",
        "revision",
        "createdAt",
        "updatedAt",
      ],
      {
        ...base,
        ownerId: oid,
        name: { bsonType: "string", minLength: 1, maxLength: 100 },
        description: { bsonType: "string", maxLength: 1000 },
        revision: { ...integer, minimum: 1 },
        createdAt: date,
        updatedAt: date,
      },
    ),
  },
  question_families: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "ownerId",
        "latestVersionId",
        "versionCount",
        "revision",
        "bankIds",
        "sharedWithUserIds",
        "createdAt",
        "updatedAt",
      ],
      {
        ...base,
        ownerId: oid,
        latestVersionId: oid,
        versionCount: { ...integer, minimum: 1 },
        revision: { ...integer, minimum: 1 },
        bankIds: oidArray(20),
        sharedWithUserIds: oidArray(50),
        createdAt: date,
        updatedAt: date,
      },
    ),
  },
  question_versions: {
    $jsonSchema: obj(
      [
        "_id",
        "schemaVersion",
        "familyId",
        "versionNumber",
        "parentVersionId",
        "restoredFromVersionId",
        "content",
        "createdBy",
        "createdAt",
      ],
      {
        ...base,
        familyId: oid,
        versionNumber: { ...integer, minimum: 1 },
        parentVersionId: { bsonType: ["objectId", "null"] },
        restoredFromVersionId: { bsonType: ["objectId", "null"] },
        content: libraryQuestion,
        createdBy: oid,
        createdAt: date,
      },
    ),
  },
});
export async function initializeDatabase(db: Db) {
  const names = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );
  for (const [name, validator] of Object.entries(validators)) {
    if (names.has(name))
      await db.command({
        collMod: name,
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
    else
      await db.createCollection(name, {
        validator,
        validationLevel: "strict",
        validationAction: "error",
      });
  }
  await db
    .collection("users")
    .createIndex({ usernameNormalized: 1 }, { unique: true });
  await db
    .collection("sessions")
    .createIndex({ tokenHash: 1 }, { unique: true });
  await db
    .collection("sessions")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("sessions").createIndex({ userId: 1 });
  await db
    .collection("question_banks")
    .createIndex({ ownerId: 1, updatedAt: -1 });
  await db
    .collection("question_families")
    .createIndex({ ownerId: 1, updatedAt: -1 });
  await db
    .collection("question_families")
    .createIndex({ sharedWithUserIds: 1, updatedAt: -1 });
  await db.collection("question_families").createIndex({ bankIds: 1 });
  await db
    .collection("question_versions")
    .createIndex({ familyId: 1, versionNumber: 1 }, { unique: true });
  await db
    .collection("surveys")
    .createIndex({ "draft.questions.source.versionId": 1 });
  await db
    .collection("survey_versions")
    .createIndex({ "definition.questions.source.versionId": 1 });
  await db.collection("surveys").createIndex({ publicId: 1 }, { unique: true });
  await db
    .collection("surveys")
    .createIndex({ ownerId: 1, updatedAt: -1, _id: -1 });
  await db
    .collection("survey_versions")
    .createIndex({ surveyId: 1, versionNumber: 1 }, { unique: true });
  await db
    .collection("responses")
    .createIndex(
      { surveyId: 1, participantKey: 1, clientAttemptId: 1 },
      { unique: true },
    );
  await db.collection("responses").createIndex(
    { surveyId: 1, participantKey: 1 },
    {
      name: "one_submission_per_participant",
      unique: true,
      partialFilterExpression: { status: "submitted", repeatAllowed: false },
    },
  );
  await db.collection("responses").createIndex({
    surveyId: 1,
    status: 1,
    surveyVersionId: 1,
    submittedAt: -1,
    _id: -1,
  });
  await db
    .collection("responses")
    .createIndex({ surveyId: 1, participantKey: 1, status: 1, updatedAt: -1 });
}
