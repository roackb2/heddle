CREATE SCHEMA IF NOT EXISTS "heddle";
--> statement-breakpoint
CREATE TABLE "heddle"."heartbeat_run_records" (
	"namespace" text NOT NULL,
	"id" text NOT NULL,
	"task_id" text NOT NULL,
	"workspace_id" text,
	"execution_id" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "heartbeat_run_records_pk" PRIMARY KEY("namespace","id")
);
--> statement-breakpoint
CREATE TABLE "heddle"."heartbeat_tasks" (
	"namespace" text NOT NULL,
	"task_id" text NOT NULL,
	"task" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"status" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"execution_id" text,
	"execution_owner_id" text,
	"lease_expires_at" timestamp with time zone,
	"checkpoint" jsonb,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "heartbeat_tasks_pk" PRIMARY KEY("namespace","task_id"),
	CONSTRAINT "heartbeat_tasks_status_valid" CHECK ("heddle"."heartbeat_tasks"."status" in ('idle', 'running', 'waiting', 'blocked', 'complete', 'failed')),
	CONSTRAINT "heartbeat_tasks_version_positive" CHECK ("heddle"."heartbeat_tasks"."version" >= 1),
	CONSTRAINT "heartbeat_tasks_execution_lease_complete" CHECK ((
        "heddle"."heartbeat_tasks"."status" = 'running'
        and "heddle"."heartbeat_tasks"."execution_id" is not null
        and "heddle"."heartbeat_tasks"."execution_owner_id" is not null
        and "heddle"."heartbeat_tasks"."lease_expires_at" is not null
      ) or (
        "heddle"."heartbeat_tasks"."status" <> 'running'
        and "heddle"."heartbeat_tasks"."execution_id" is null
        and "heddle"."heartbeat_tasks"."execution_owner_id" is null
        and "heddle"."heartbeat_tasks"."lease_expires_at" is null
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "heartbeat_run_records_execution_idx" ON "heddle"."heartbeat_run_records" USING btree ("namespace","execution_id");
--> statement-breakpoint
CREATE INDEX "heartbeat_run_records_task_created_idx" ON "heddle"."heartbeat_run_records" USING btree ("namespace","task_id","created_at");
--> statement-breakpoint
CREATE INDEX "heartbeat_tasks_due_idx" ON "heddle"."heartbeat_tasks" USING btree ("namespace","enabled","status","next_run_at");
--> statement-breakpoint
CREATE INDEX "heartbeat_tasks_recovery_idx" ON "heddle"."heartbeat_tasks" USING btree ("namespace","status","lease_expires_at");
