// Public surface of the identity slice in apps/admin (#49): the staff session and the sign-in screen.

export { SignIn } from "./SignIn.tsx";
export {
  readFragment,
  type SessionState,
  StaffSessionProvider,
  useStaffSession,
} from "./session.tsx";
