# features/identity/onboarding.feature
Feature: Onboarding and consents
  Matching cannot start without four answers (gender, seeks, an age window,
  a pond) and nothing may start without two consents given for the exact
  wording and version the person read (TD-17: the Finnish text is binding).
  The research opt-in has its own yes and can be withdrawn. The account
  becomes active when everything required is there (#46, ADR-010).

  Scenario: A consent counts only for the current version of its wording
    Given the terms have a current consent version
    When the account sends a consent for an older version
    Then the answer is 409 agreement_outdated and no consent row is written

  Scenario: The same consent is recorded once
    Given the account gave the terms consent for the current version
    When it sends the same consent again
    Then there is still one consent row for the terms

  Scenario: The research opt-in can be withdrawn and given again
    Given the account gave the research consent
    When it withdraws and later gives it again
    Then two rows exist, one withdrawn and one active, and the status shows the active one

  Scenario: Terms and privacy have no withdrawal route
    When the account tries to withdraw the terms or the privacy consent
    Then there is no such route

  Scenario: The account becomes active when every required answer is there
    Given a registered account that has answered nothing
    When it declares a gender, sets seeks and an age window, chooses a pond and gives both consents
    Then the status lists fewer missing steps after each answer and the account is active at the end

  Scenario: Research is never required for activation
    Given a registered account with every required answer and no research consent
    Then the account is active and the status shows no research opt-in

  Scenario: Erasure removes the preferences, keeps the consents and blanks gender and pond
    Given an onboarded account
    When the account is deleted
    Then its preference rows are gone, its consent rows remain and the tombstone has neither gender nor pond

  Scenario: The export lists gender, pond, preferences and every consent
    Given an onboarded account with a withdrawn research consent
    When it downloads its export
    Then the export carries the gender, the pond with both case forms, the two hard preferences and every consent row
