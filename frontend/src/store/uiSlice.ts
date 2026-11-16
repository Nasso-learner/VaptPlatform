import { createSlice } from "@reduxjs/toolkit";

type UiState = { sidebarCollapsed: boolean; mobileNavOpen: boolean; paletteOpen: boolean };

const slice = createSlice({
  name: "ui",
  initialState: { sidebarCollapsed: false, mobileNavOpen: false, paletteOpen: false } as UiState,
  reducers: {
    setSidebarCollapsed(state, action: { payload: boolean }) {
      state.sidebarCollapsed = action.payload;
    },
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setMobileNav(state, action: { payload: boolean }) {
      state.mobileNavOpen = action.payload;
    },
    setPalette(state, action: { payload: boolean }) {
      state.paletteOpen = action.payload;
    },
  },
});

export const { setSidebarCollapsed, toggleSidebar, setMobileNav, setPalette } = slice.actions;
export default slice.reducer;
