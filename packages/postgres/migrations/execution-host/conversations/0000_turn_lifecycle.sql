CREATE SCHEMA IF NOT EXISTS "heddle";
--> statement-breakpoint
CREATE TABLE "heddle"."execution_host_conversation_turns" (
	"invocation_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"product_session_id" text NOT NULL,
	"prompt" text NOT NULL,
	"deadline_at" timestamp with time zone,
	"status" text NOT NULL,
	"run_id" text,
	"summary" text,
	"failure_code" text,
	"requested_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "execution_host_conversation_turns_pk" PRIMARY KEY("invocation_id"),
	CONSTRAINT "execution_host_conversation_turns_invocation_id_valid" CHECK ("invocation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'),
	CONSTRAINT "execution_host_conversation_turns_scope_valid" CHECK (
		"tenant_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'
		and "subject_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'
		and "product_session_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'
	),
	CONSTRAINT "execution_host_conversation_turns_prompt_valid" CHECK (char_length(btrim("prompt")) between 1 and 200000),
	CONSTRAINT "execution_host_conversation_turns_summary_valid" CHECK ("summary" is null or char_length("summary") <= 1000000),
	CONSTRAINT "execution_host_conversation_turns_status_valid" CHECK ("status" in (
		'requested', 'running', 'completed', 'max_steps',
		'failed', 'cancelled', 'interrupted'
	)),
	CONSTRAINT "execution_host_conversation_turns_failure_code_valid" CHECK ("failure_code" is null or "failure_code" in (
		'execution_error', 'execution_failed', 'execution_result_error',
		'host_protocol_error', 'host_rejected', 'model_authentication',
		'model_context_window', 'model_empty_response', 'model_permission',
		'model_quota', 'model_rate_limit', 'model_request',
		'model_transport', 'model_unknown', 'deadline_elapsed',
		'execution_interrupted', 'invocation_aborted',
		'stream_ended_without_terminal', 'stream_interrupted',
		'invocation_cancelled'
	)),
	CONSTRAINT "execution_host_conversation_turns_acceptance_complete" CHECK (("run_id" is null) = ("accepted_at" is null)),
	CONSTRAINT "execution_host_conversation_turns_state_shape_valid" CHECK ((
		"status" = 'requested'
		and "run_id" is null
		and "summary" is null
		and "failure_code" is null
		and "settled_at" is null
	) or (
		"status" = 'running'
		and "run_id" is not null
		and "summary" is null
		and "failure_code" is null
		and "settled_at" is null
	) or (
		"status" in ('completed', 'max_steps')
		and "run_id" is not null
		and "failure_code" is null
		and "settled_at" is not null
	) or (
		"status" = 'failed'
		and "failure_code" in (
			'execution_error', 'execution_failed', 'execution_result_error',
			'host_protocol_error', 'host_rejected', 'model_authentication',
			'model_context_window', 'model_empty_response',
			'model_permission', 'model_quota', 'model_rate_limit',
			'model_request', 'model_transport', 'model_unknown'
		)
		and "settled_at" is not null
	) or (
		"status" = 'interrupted'
		and "failure_code" in (
			'deadline_elapsed', 'execution_interrupted',
			'invocation_aborted', 'stream_ended_without_terminal',
			'stream_interrupted'
		)
		and "settled_at" is not null
	) or (
		"status" = 'cancelled'
		and "run_id" is not null
		and "summary" is null
		and "failure_code" = 'invocation_cancelled'
		and "settled_at" is not null
	))
);
--> statement-breakpoint
CREATE INDEX "execution_host_conversation_turns_expiry_idx" ON "heddle"."execution_host_conversation_turns" USING btree ("tenant_id","subject_id","product_session_id","status","deadline_at");
