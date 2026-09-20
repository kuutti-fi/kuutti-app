# features/identity/re-registration.feature
Feature: Re-registration after deletion or ban
  A ban belongs to the identity, not the account (TD-1, TD-7), so deleting
  an account and authenticating again must not clear a sanction.

  @pending
  Scenario: A banned identity cannot come back
    Given identity "A" has standing "banned"
    When "A" authenticates with their bank
    Then no account is created
    And the refused attempt is recorded on the identity

  @pending
  Scenario Outline: Deletion cooldown
    Given identity "A" deleted their account <days> days ago
    And identity "A" has standing "ok"
    When "A" authenticates with their bank
    Then account creation is <outcome>

    Examples:
      | days | outcome |
      | 0    | refused |
      | 29   | refused |
      | 30   | allowed |

  Scenario: THROWAWAY orphan scenario without a test
    Given nothing
    Then the scenarios check is red
