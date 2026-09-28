# features/pond/gate.feature
Feature: The pond gate
  Between a finished profile and the first round stand two things (TD-10,
  TD-13, TD-14; #94, ADR-015). Admission: most people are let into their pond
  at once; where one group is the larger among those who seek another gender
  than their own, its newcomers wait in the order they registered. And the
  gate: matching opens for a person when enough people are there who match
  what they seek and whose wishes they match. The rules name no gender, no
  hard filter is ever crossed (rule 7), and nobody is let out again when the
  pond drifts. What a person is told of it is said in tens, never exactly,
  and only the night moves it: a figure that answered every question put to
  it would say what one other person seeks (TD-14).

  Scenario Outline: Two people are in each other's pool only when each passes what the other asked for
    Given a <a_gender> of <a_age> who seeks <a_seeks> between <a_min> and <a_max>
    And a <b_gender> of <b_age> who seeks <b_seeks> between <b_min> and <b_max>
    Then they are <in> each other's pool, asked from either side

    Examples:
      | a_gender   | a_age | a_seeks          | a_min | a_max | b_gender   | b_age | b_seeks    | b_min | b_max | in     |
      | woman      | 30    | man              | 25    | 40    | man        | 35    | woman      | 25    | 40    | in     |
      | woman      | 30    | man              | 25    | 40    | man        | 35    | man        | 25    | 40    | not in |
      | woman      | 30    | man              | 25    | 34    | man        | 35    | woman      | 25    | 40    | not in |
      | woman      | 41    | man              | 25    | 45    | man        | 35    | woman      | 25    | 40    | not in |
      | woman      | 30    | woman            | 25    | 40    | woman      | 28    | woman      | 25    | 40    | in     |
      | non_binary | 30    | man,non_binary   | 25    | 40    | man        | 35    | non_binary | 25    | 40    | in     |
      | non_binary | 30    | man              | 25    | 40    | man        | 35    | woman      | 25    | 40    | not in |
      | woman      | 25    | man              | 25    | 40    | man        | 40    | woman      | 25    | 40    | in     |

  Scenario: The smaller group is always let in, the larger while it is at most its share
    Given a pond where six of one group and four of the other are let in, all seeking the other
    When two more of the larger group finish their profile
    Then they wait, first and second, in the order they registered
    When one of the smaller group finishes their profile
    Then that one is let in, and the first in line with them
    And the one who is left is first in line

  Scenario: A newcomer of the smaller group opens the way for those who waited
    Given a pond where three of one group are let in and two more of it wait
    When three of the other group finish their profile and the gates are counted
    Then the three are let in, and so is the one who waited longest
    And the other one is first in the waitlist

  Scenario: People who seek their own gender, and non-binary people, never wait
    Given a pond where one group is far over its share
    When a person of that group who seeks their own gender too, and a non-binary person, finish their profile
    Then both are let in at once

  Scenario: Nobody is let out again when the pond drifts
    Given a pond where the larger group is at its share and everybody is let in
    When people of the smaller group leave and the gates are counted
    Then everybody who was let in is let in still

  Scenario: Matching opens when the pool reaches gate_k, and stays open
    Given a person let into a pond where twenty-nine people match them, and gate_k is thirty
    When the gates are counted
    Then the person's gate is closed and they are told that about ten more are needed
    When one more person who matches joins and the gates are counted
    Then the person's gate is open
    When five of those people leave and the gates are counted
    Then the person's gate is open still

  Scenario: What a person is told is said in tens, and follows slowly
    Given a person let into a pond where seventeen people match them, and gate_k is thirty
    When the gates are counted
    Then the person is told that about twenty more are needed
    When two more people who match join and the gates are counted
    Then the person is told twenty still
    When one more joins and the gates are counted
    Then the person is told ten
    When that one leaves again and the gates are counted
    Then the person is told ten still

  Scenario: The place in the line is said in tens
    Given a pond where eleven of the larger group wait
    When the gates are counted
    Then the first ten in the line are each told that they are among the next ten
    And the eleventh that they are among the next twenty

  Scenario: Only a finished profile and current consents are counted
    Given a pond with a person whose profile lacks its photos, one whose consent is for an older wording, a shadow-banned one and a paused one
    When the gates are counted
    Then none of them is in anybody's pool
    And the shadow-banned person has a gate of their own, like anybody

  Scenario: Counting twice changes nothing
    Given a pond that was counted
    When it is counted again at once
    Then every place, every figure and every date is what it was

  Scenario: A person learns where they stand the first time they ask
    Given a person who finished their profile since the last count
    When they ask for their gate
    Then they are counted then and there, and told their place or how many are needed
    And nobody else's figure has moved

  Scenario: Another person's gate is never served
    Given two people in one pond, one of them waiting
    When the other asks for their gate
    Then they are told their own and nothing of the first

  Scenario: The place stays behind with the pond, and the night says the new one
    Given a person for whom matching is open in their pond
    When they choose another pond
    Then they are neither let in nor in the line there, and asking counts nothing
    When the gates are counted
    Then they are told where they stand in the pond they went to

  Scenario: Admission is decided anew for a person who joins a group that waits
    Given two people of the larger group who wait, and one of them declares that they seek their own gender too
    When the gates are counted
    Then that one is let in
    When they take the declaration back
    Then they are neither let in nor in the line until the gates are counted
    And the next place that opens goes to the one who registered first

  Scenario: Erasure removes the place at the gate
    Given a person with a place at the gate
    When they delete their account
    Then no row of the gate names them
