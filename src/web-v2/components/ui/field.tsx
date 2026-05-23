import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@web/lib/utils';

const FieldGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-4', className)} {...props} />
));
FieldGroup.displayName = 'FieldGroup';

const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props} />
));
Field.displayName = 'Field';

const FieldLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('v2-type-caption text-foreground', className)}
    {...props}
  />
));
FieldLabel.displayName = LabelPrimitive.Root.displayName;

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('v2-type-caption text-muted-foreground', className)} {...props} />
));
FieldDescription.displayName = 'FieldDescription';

const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('v2-type-caption text-destructive', className)} {...props} />
));
FieldError.displayName = 'FieldError';

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
};
