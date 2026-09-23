# features/identity/sessions.feature
Feature: Device-bound sessions
  Bank ID is the account (TD-1): there is no password to reset. A device holds
  a short-lived access token and a single-use refresh token; losing a phone is
  answered by one new bank login and "log out everywhere".

  Scenario: An exchanged code yields a session that answers as the account
    Given "A" has completed a bank login and holds the one-time code
    When the app exchanges the code
    Then it receives an access token and a refresh token
    And the access token answers as "A"'s account

  Scenario: A refresh rotates both tokens and retires the old ones
    Given a device holds a session
    When it refreshes
    Then it receives a new pair
    And the previous access token no longer answers

  Scenario: A refresh token used twice ends the device's session
    Given a device has refreshed once
    When the retired refresh token is presented again
    Then the answer is session_revoked
    And the pair from the first refresh no longer answers either

  Scenario: An expired access token asks for a refresh
    Given a device's access token has passed its fifteen minutes
    When it calls a protected route
    Then the answer is session_expired
    And a refresh still succeeds

  Scenario: Logging out this device leaves the other devices signed in
    Given "A" is signed in on two devices
    When the first device logs out
    Then the first device's tokens stop working
    And the second device still answers

  Scenario: Logging out everywhere ends every device's session
    Given "A" is signed in on two devices
    When one device logs out everywhere
    Then neither device answers on its next request

  Scenario: A session of a sanctioned account stops answering
    Given "A" is signed in
    When "A"'s account is banned
    Then the next request answers session_revoked
