import type { ObjectId } from "mongodb";
import type {
  Answer,
  Definition,
} from "../../../packages/shared/src/domain.js";
export interface User {
  _id: ObjectId;
  schemaVersion: 1;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface Session {
  _id: ObjectId;
  schemaVersion: 1;
  tokenHash: string;
  userId: ObjectId;
  csrfToken: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface Survey {
  _id: ObjectId;
  schemaVersion: 1;
  ownerId: ObjectId;
  publicId: string;
  title: string;
  status: "draft" | "published" | "closed";
  deadlineAt: Date | null;
  draft: Definition | null;
  activeVersionId: ObjectId | null;
  activeVersionNumber: number;
  revision: number;
  submissionGateSeq: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  closedAt: Date | null;
}
export interface Version {
  _id: ObjectId;
  schemaVersion: 1;
  surveyId: ObjectId;
  versionNumber: number;
  sourceDraftRevision: number;
  definition: Definition;
  createdBy: ObjectId;
  publishedAt: Date;
}
export interface Response {
  _id: ObjectId;
  schemaVersion: 1;
  surveyId: ObjectId;
  surveyVersionId: ObjectId;
  participantKey: string;
  clientAttemptId: string;
  status: "in_progress" | "submitted";
  isAnonymous: boolean;
  respondentId: ObjectId | null;
  repeatAllowed: boolean;
  answers: Answer[];
  visitedQuestionIds: string[];
  revision: number;
  submissionHash: string | null;
  lastSubmissionId: string | null;
  editDraft: { answers: Answer[] } | null;
  editCount: number;
  startedAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  submittedAt: Date | null;
  lastSubmittedAt: Date | null;
}
