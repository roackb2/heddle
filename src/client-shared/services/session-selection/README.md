# Session Selection Service

`ClientSharedSessionSelectionService` owns the implicit startup selection used
by Heddle clients. When no route or CLI argument names a session, it resumes the
session with the newest `updatedAt` timestamp, falling back to `createdAt` for
compatible older views.

Pinning is deliberately excluded from this decision. It is presentation
metadata used to group frequently accessed sessions in navigation; it must not
replace the user's most recently active session as the startup destination.

Concrete clients still own explicit navigation. A session named in a browser
route or CLI option takes precedence before this service is called.
