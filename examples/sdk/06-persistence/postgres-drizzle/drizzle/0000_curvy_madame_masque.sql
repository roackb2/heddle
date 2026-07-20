CREATE TABLE "heddle_chat_session_archive_heads" (
	"scope_id" text NOT NULL,
	"session_id" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "heddle_chat_session_archive_heads_pk" PRIMARY KEY("scope_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "heddle_chat_session_archives" (
	"scope_id" text NOT NULL,
	"session_id" text NOT NULL,
	"archive_id" text NOT NULL,
	"archive_record" jsonb NOT NULL,
	"messages" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "heddle_chat_session_archives_pk" PRIMARY KEY("scope_id","session_id","archive_id")
);
--> statement-breakpoint
CREATE TABLE "heddle_chat_sessions" (
	"scope_id" text NOT NULL,
	"id" text NOT NULL,
	"revision" bigint NOT NULL,
	"session" jsonb NOT NULL,
	"workspace_id" text,
	"pinned" boolean NOT NULL,
	"archived_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "heddle_chat_sessions_pk" PRIMARY KEY("scope_id","id"),
	CONSTRAINT "heddle_chat_sessions_revision_positive" CHECK ("heddle_chat_sessions"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "heddle_chat_sessions_catalog_idx" ON "heddle_chat_sessions" USING btree ("scope_id","pinned" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"id" collate "C" asc);