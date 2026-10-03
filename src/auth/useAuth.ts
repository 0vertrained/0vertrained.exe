// Reads the account context. Like useAppData, it throws outside its
// provider, so a missing <AuthProvider> is a loud setup error rather than a
// sheet that silently never signs in.
import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./authContext";

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}
