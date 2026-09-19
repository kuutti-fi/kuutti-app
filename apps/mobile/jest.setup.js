// Reanimated 4 and its worklets runtime are native; in jest they run as the
// mocks the two packages ship (#12).
jest.mock("react-native-worklets", () => require("react-native-worklets/lib/module/mock"));
require("react-native-reanimated").setUpTests();
