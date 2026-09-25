# features/safety/audit.feature
Feature: The audit log is append-only
  Every moderator action and every photo a member of staff looks at is a row
  that says who, what, on which subject and when (TD-5, security checklist).
  History is not rewritten: not by a route, not by the application role.

  Scenario: An audit row is written with who, what, subject and when
    When a member of staff does something audited
    Then audit_log has a row with their identity, the action, the subject and a time

  Scenario: An audit row cannot be updated or deleted
    Given an audit row
    When the application role tries to update or delete it
    Then the database refuses and the row is unchanged
