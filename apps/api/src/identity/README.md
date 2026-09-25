# identity

Bank-ID registration, identity standing, accounts, sessions, re-registration. TD-1, TD-7. Staff sessions (#49, ADR-006): the same bank login marked as a staff attempt resolves to an identity with a `moderator_roles` row and an eight-hour admin session (`admin-session.ts`), never to an account.
