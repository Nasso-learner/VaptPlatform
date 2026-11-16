import { createSlice } from "@reduxjs/toolkit";

import type { User } from "@/types/api";

type AuthState = {
  user: User | null;
  /** unknown: still checking the session; anonymous: signed out. */
  status: "unknown" | "authenticated" | "anonymous";
};

const slice = createSlice({
  name: "auth",
  initialState: { user: null, status: "unknown" } as AuthState,
  reducers: {
    signedIn(state, action: { payload: User }) {
      state.user = action.payload;
      state.status = "authenticated";
    },
    signedOut(state) {
      state.user = null;
      state.status = "anonymous";
    },
  },
});

export const { signedIn, signedOut } = slice.actions;
export default slice.reducer;
