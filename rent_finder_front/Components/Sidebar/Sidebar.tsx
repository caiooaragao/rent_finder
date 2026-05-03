"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import {
  ChevronLeft,
  ChevronRight,
  DarkModeOutlined,
  FavoriteBorder,
  LightModeOutlined,
} from "@mui/icons-material";
import { useTheme as useNextTheme } from "next-themes";
import { HomeSpreadLogo } from "@/Components/HomeSpreadLogo";

const EXPANDED_WIDTH = 286;
const COLLAPSED_WIDTH = 68;

const TRANSITION_OPTIONS = {
  easing: "ease-in-out",
  duration: 260,
} as const;

// importante! não colocar de novo nada nesta lista, O SIDEBAR NÃO TEM MAIS NAV
const NAV_IN_APP = [
  // { key: "buscar" as const, label: "Buscar", Icon: SearchOutlined },
  // { key: "mapa" as const, label: "Mapa", Icon: MapOutlined },
] as const;

function SidebarThemeToggle() {
  const { resolvedTheme, setTheme } = useNextTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  const toggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  const title = isDark
    ? "Tema escuro — clique para tema claro"
    : "Tema claro — clique para tema escuro";

  const Icon = isDark ? DarkModeOutlined : LightModeOutlined;

  if (!mounted) {
    return (
      <Box
        aria-hidden
        sx={{ width: 34, height: 34, flexShrink: 0 }}
      />
    );
  }

  return (
    <Tooltip title={title} placement="bottom">
      <IconButton
        type="button"
        onClick={toggle}
        size="small"
        aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
        sx={{ color: "var(--rf-sidebar-fg)", flexShrink: 0 }}
      >
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

export interface SidebarProps {
  open?: boolean;
  onToggle?: (open: boolean) => void;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}

export const Sidebar: React.FC<SidebarProps> = ({
  open: controlledOpen,
  onToggle,
  defaultOpen = true,
  children,
}) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  const drawerWidth = isOpen ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  const paperSx = {
    width: drawerWidth,
    overflowX: "hidden",
    boxSizing: "border-box" as const,
    borderRight: "1px solid",
    borderColor: "divider",
    transition: `width ${TRANSITION_OPTIONS.duration}ms ${TRANSITION_OPTIONS.easing}`,
    background: "var(--rf-sidebar-bg)",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxHeight: "100vh",
  };

  return (
    <Drawer variant="permanent" slotProps={{ paper: { sx: paperSx } }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 0.5,
          height: 56,
          px: 1.25,
          pr: 0.5,
          minWidth: 0,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <HomeSpreadLogo size={isOpen ? 34 : 30} />
          {isOpen ? (
            <Typography
              component="span"
              variant="h6"
              sx={{
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "var(--rf-sidebar-fg)",
                fontSize: "1.125rem",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Find my home 
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>
          <SidebarThemeToggle />
          <Tooltip title={isOpen ? "Recolher" : "Expandir"} placement="right">
            <IconButton
              onClick={handleToggle}
              size="small"
              aria-label={isOpen ? "Recolher menu" : "Expandir menu"}
              aria-expanded={isOpen}
              sx={{ color: "var(--rf-sidebar-fg)", flexShrink: 0 }}
            >
              {isOpen ? <ChevronLeft /> : <ChevronRight />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Divider />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {isOpen && children ? (
          <Box
            sx={{
              flexShrink: 0,
              width: "100%",
              minWidth: 0,
              px: 1.25,
              pt: 1.25,
              pb: 1,
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            {children}
          </Box>
        ) : null}

        <Box
          component="footer"
          aria-label="Salvos — funcionalidade em breve"
          sx={{
            flexShrink: 0,
            px: 0.75,
            pt: isOpen ? 1 : 0.5,
            pb: 1,
            mt: isOpen ? 0 : "auto",
          }}
        >
          <Tooltip
            title={isOpen ? "Em breve" : "Salvos — em breve"}
            placement="right"
          >
            <span style={{ width: "100%", display: "block" }}>
              <ListItemButton
                disabled
                sx={{
                  borderRadius: 2,
                  minHeight: 44,
                  px: isOpen ? 2 : 1.25,
                  justifyContent: isOpen ? "flex-start" : "center",
                  opacity: 0.55,
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    mr: isOpen ? 1.75 : 0,
                    justifyContent: "center",
                    color: "var(--rf-sidebar-fg)",
                  }}
                >
                  <FavoriteBorder />
                </ListItemIcon>
                <ListItemText
                  primary="Salvos"
                  secondary={isOpen ? "Em breve" : undefined}
                  slotProps={{
                    primary: {
                      sx: {
                        fontWeight: 500,
                        fontSize: "0.875rem",
                        color: "var(--rf-sidebar-fg)",
                        whiteSpace: "nowrap",
                      },
                    },
                    secondary: {
                      sx: {
                        fontSize: "0.6875rem",
                        lineHeight: 1.2,
                        color: "text.secondary",
                      },
                    },
                  }}
                  sx={{
                    opacity: isOpen ? 1 : 0,
                    maxWidth: isOpen ? 180 : 0,
                    overflow: "hidden",
                  }}
                />
              </ListItemButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
    </Drawer>
  );
};

export default Sidebar;
