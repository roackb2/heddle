import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { ControlPlaneModelOptions, RouterInputs } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@web/components/ui/field';
import { Input } from '@web/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { Textarea } from '@web/components/ui/textarea';
import { useI18n } from '@web/i18n';

const DEFAULT_MODEL_VALUE = '__default__';

const taskCreateSchema = z.object({
  name: z.string().trim().min(1, 'Task name is required.'),
  task: z.string().trim().min(1, 'Task instruction is required.'),
  intervalMs: z.string().min(1, 'Schedule is required.'),
  model: z.string().optional(),
  maxSteps: z.string().trim().optional().refine((value) => {
    if (!value) {
      return true;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 500;
  }, 'Max steps must be between 1 and 500.'),
});

type TaskCreateDialogValues = z.infer<typeof taskCreateSchema>;
export type TaskCreateInput = RouterInputs['controlPlane']['heartbeatTaskCreate'];

type TaskCreateSubmitOptions = {
  runNow: boolean;
};

interface TaskCreateDialogProps {
  error?: string;
  modelOptions?: ControlPlaneModelOptions;
  open: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TaskCreateInput, options: TaskCreateSubmitOptions) => Promise<void>;
}

const intervalOptions = [
  { labelKey: 'tasks.create.scheduleEvery15Minutes', value: '900000' },
  { labelKey: 'tasks.create.scheduleEvery30Minutes', value: '1800000' },
  { labelKey: 'tasks.create.scheduleEveryHour', value: '3600000' },
  { labelKey: 'tasks.create.scheduleEverySixHours', value: '21600000' },
  { labelKey: 'tasks.create.scheduleEveryDay', value: '86400000' },
] as const;

export function TaskCreateDialog({
  error,
  modelOptions,
  open,
  submitting,
  onOpenChange,
  onSubmit,
}: TaskCreateDialogProps) {
  const { t } = useI18n();
  const form = useForm<TaskCreateDialogValues>({
    resolver: zodResolver(taskCreateSchema),
    defaultValues: {
      name: '',
      task: '',
      intervalMs: '3600000',
      model: DEFAULT_MODEL_VALUE,
      maxSteps: '',
    },
  });

  async function submit(values: TaskCreateDialogValues, options: TaskCreateSubmitOptions) {
    const input = normalizeTaskCreateInput(values);
    await onSubmit(input, options);
    form.reset();
  }

  function updateOpen(nextOpen: boolean) {
    if (!submitting) {
      onOpenChange(nextOpen);
    }
    if (!nextOpen) {
      form.clearErrors();
    }
  }

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <DialogContent className="v2-task-create-dialog">
        <DialogHeader>
          <DialogTitle>{t('tasks.create.title')}</DialogTitle>
          <DialogDescription>{t('tasks.create.description')}</DialogDescription>
        </DialogHeader>

        <form className="min-w-0" onSubmit={form.handleSubmit((values) => submit(values, { runNow: false }))}>
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.name)}>
              <FieldLabel htmlFor="task-create-name">{t('tasks.create.name')}</FieldLabel>
              <Input
                id="task-create-name"
                autoComplete="off"
                aria-invalid={Boolean(form.formState.errors.name)}
                placeholder={t('tasks.create.namePlaceholder')}
                {...form.register('name')}
              />
              <FieldError>{form.formState.errors.name?.message}</FieldError>
            </Field>

            <Field data-invalid={Boolean(form.formState.errors.task)}>
              <FieldLabel htmlFor="task-create-task">{t('tasks.create.task')}</FieldLabel>
              <Textarea
                id="task-create-task"
                aria-invalid={Boolean(form.formState.errors.task)}
                className="min-h-24 rounded-md border border-input bg-background px-3 py-2"
                placeholder={t('tasks.create.taskPlaceholder')}
                {...form.register('task')}
              />
              <FieldError>{form.formState.errors.task?.message}</FieldError>
            </Field>

            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <Field data-invalid={Boolean(form.formState.errors.intervalMs)}>
                <FieldLabel>{t('tasks.create.schedule')}</FieldLabel>
                <Select
                  value={form.watch('intervalMs')}
                  onValueChange={(value) => form.setValue('intervalMs', value, { shouldDirty: true, shouldValidate: true })}
                >
                  <SelectTrigger aria-invalid={Boolean(form.formState.errors.intervalMs)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {intervalOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{form.formState.errors.intervalMs?.message}</FieldError>
              </Field>

              <Field data-invalid={Boolean(form.formState.errors.maxSteps)}>
                <FieldLabel htmlFor="task-create-max-steps">{t('tasks.create.maxSteps')}</FieldLabel>
                <Input
                  id="task-create-max-steps"
                  inputMode="numeric"
                  aria-invalid={Boolean(form.formState.errors.maxSteps)}
                  placeholder={t('tasks.create.maxStepsPlaceholder')}
                  {...form.register('maxSteps')}
                />
                <FieldError>{form.formState.errors.maxSteps?.message}</FieldError>
              </Field>
            </div>

            <Field>
              <FieldLabel>{t('tasks.create.model')}</FieldLabel>
              <Select
                value={form.watch('model')}
                onValueChange={(value) => form.setValue('model', value, { shouldDirty: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL_VALUE}>{t('tasks.create.defaultModel')}</SelectItem>
                  {modelOptions?.groups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.options.map((option) => (
                        <SelectItem key={option.id} value={option.id} disabled={option.disabled}>
                          {option.label ?? option.id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="v2-type-caption text-muted-foreground">{t('tasks.create.modelDescription')}</p>
            </Field>

            {error ? <p className="v2-type-caption text-destructive">{error}</p> : null}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={submitting} onClick={() => updateOpen(false)}>
              {t('tasks.create.cancel')}
            </Button>
            <Button type="submit" variant="secondary" disabled={submitting}>
              {t('tasks.create.create')}
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={form.handleSubmit((values) => submit(values, { runNow: true }))}
            >
              {t('tasks.create.createAndRun')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function normalizeTaskCreateInput(values: TaskCreateDialogValues): TaskCreateInput {
  const maxSteps = values.maxSteps ? Number(values.maxSteps) : undefined;
  const model = values.model && values.model !== DEFAULT_MODEL_VALUE ? values.model : undefined;
  return {
    name: values.name.trim(),
    task: values.task.trim(),
    intervalMs: Number(values.intervalMs),
    model,
    maxSteps,
  };
}
