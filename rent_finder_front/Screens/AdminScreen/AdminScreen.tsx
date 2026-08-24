"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  CloudDownloadOutlined,
  LogoutOutlined,
  PersonAddOutlined,
} from "@mui/icons-material";

type AdminUser = {
  id: number;
  username: string;
  fullName: string | null;
  phone: string | null;
  isAdmin: boolean;
  createdAt: string;
};

type SessionUser = {
  id: number;
  username: string;
  fullName: string | null;
};

type AdminScreenProps = {
  initialSession: SessionUser | null;
};

function AdminLoginForm({
  onSuccess,
}: {
  onSuccess: (user: SessionUser) => void;
}) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: SessionUser;
      };

      if (!res.ok) {
        setError(data.error ?? "Falha no login");
        return;
      }

      if (data.user) onSuccess(data.user);
    } catch {
      setError("Não foi possível conectar ao servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card sx={{ maxWidth: 420, width: "100%" }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Login administrativo
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Acesso restrito ao painel de administração.
        </Typography>

        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {error ? <Alert severity="error">{error}</Alert> : null}

            <TextField
              label="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              fullWidth
            />
            <TextField
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              fullWidth
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              startIcon={
                loading ? <CircularProgress size={18} color="inherit" /> : null
              }
            >
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

function AddUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (user: AdminUser) => void;
}) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const reset = () => {
    setUsername("");
    setPassword("");
    setFullName("");
    setPhone("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, fullName, phone }),
      });
      const data = (await res.json()) as { error?: string; user?: AdminUser };

      if (!res.ok) {
        setError(data.error ?? "Falha ao criar usuário");
        return;
      }

      if (data.user) {
        onCreated(data.user);
        handleClose();
      }
    } catch {
      setError("Não foi possível conectar ao servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo usuário admin</DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Nome completo"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              fullWidth
            />
            <TextField
              label="Telefone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? "Criando…" : "Criar usuário"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function ScrapeLogPanel({
  logs,
  running,
  exitCode,
}: {
  logs: string[];
  running: boolean;
  exitCode: number | null;
}) {
  const logEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, running]);

  if (logs.length === 0 && !running) return null;

  return (
    <Card>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            mb: 1.5,
          }}
        >
          <Typography variant="subtitle1" fontWeight={600}>
            Log do scrape
          </Typography>
          {running ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Executando…
              </Typography>
            </Box>
          ) : exitCode !== null ? (
            <Typography
              variant="body2"
              color={exitCode === 0 ? "success.main" : "error.main"}
              fontWeight={600}
            >
              {exitCode === 0 ? "Concluído" : `Código ${exitCode}`}
            </Typography>
          ) : null}
        </Box>

        <Box
          component="pre"
          sx={{
            m: 0,
            p: 2,
            maxHeight: 360,
            overflow: "auto",
            borderRadius: 1,
            bgcolor: "action.hover",
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            fontSize: "0.8rem",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {logs.length === 0 ? "Aguardando saída do script…" : logs.join("\n")}
          <div ref={logEndRef} />
        </Box>
      </CardContent>
    </Card>
  );
}

function AdminPanel({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(true);
  const [addOpen, setAddOpen] = React.useState(false);
  const [scrapeRunning, setScrapeRunning] = React.useState(false);
  const [scrapeLogs, setScrapeLogs] = React.useState<string[]>([]);
  const [scrapeExitCode, setScrapeExitCode] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const scrapeAbortRef = React.useRef<AbortController | null>(null);

  const loadUsers = React.useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = (await res.json()) as { users?: AdminUser[] };
      if (res.ok && data.users) setUsers(data.users);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadScrapeState = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/scrape");
      const data = (await res.json()) as {
        running?: boolean;
        logs?: string[];
        exitCode?: number | null;
      };
      if (!res.ok) return;
      setScrapeRunning(Boolean(data.running));
      if (data.logs?.length) setScrapeLogs(data.logs);
      if (data.exitCode !== undefined) setScrapeExitCode(data.exitCode);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    void loadUsers();
    void loadScrapeState();
  }, [loadUsers, loadScrapeState]);

  React.useEffect(() => {
    return () => {
      scrapeAbortRef.current?.abort();
    };
  }, []);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    onLogout();
  };

  const handleRunScrape = async () => {
    if (scrapeRunning) return;

    setMessage(null);
    setScrapeLogs([]);
    setScrapeExitCode(null);
    setScrapeRunning(true);

    const abortController = new AbortController();
    scrapeAbortRef.current = abortController;

    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
        signal: abortController.signal,
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/x-ndjson")) {
        const data = (await res.json()) as { error?: string };
        setMessage({
          type: "error",
          text: data.error ?? "Falha ao iniciar scrape",
        });
        setScrapeRunning(false);
        return;
      }

      if (!res.body) {
        setMessage({ type: "error", text: "Resposta sem stream de log" });
        setScrapeRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const event = JSON.parse(line) as {
            type: string;
            line?: string;
            message?: string;
            code?: number | null;
          };

          if (event.type === "log" && event.line) {
            setScrapeLogs((prev) => [...prev, event.line!]);
          } else if (event.type === "start" && event.message) {
            setScrapeLogs([event.message]);
          } else if (event.type === "error" && event.message) {
            setScrapeLogs((prev) => [...prev, `[erro] ${event.message}`]);
            setMessage({ type: "error", text: event.message });
          } else if (event.type === "done") {
            setScrapeExitCode(event.code ?? null);
            setMessage({
              type: event.code === 0 ? "success" : "error",
              text:
                event.code === 0
                  ? "Scrape concluído com sucesso."
                  : `Scrape finalizado com código ${event.code ?? "desconhecido"}.`,
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage({ type: "info", text: "Conexão com o log encerrada." });
      } else {
        setMessage({
          type: "error",
          text: "Não foi possível conectar ao servidor",
        });
      }
    } finally {
      scrapeAbortRef.current = null;
      setScrapeRunning(false);
      void loadScrapeState();
    }
  };

  return (
    <Stack spacing={3} sx={{ width: "100%", maxWidth: 720 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Painel admin
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Logado como {user.fullName || user.username}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<LogoutOutlined />}
          onClick={() => void handleLogout()}
        >
          Sair
        </Button>
      </Box>

      {message ? (
        <Alert severity={message.type} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Ações
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 1 }}>
            <Button
              variant="contained"
              startIcon={<PersonAddOutlined />}
              onClick={() => setAddOpen(true)}
            >
              Adicionar usuário
            </Button>
            <Button
              variant="contained"
              color="secondary"
              startIcon={
                scrapeRunning ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <CloudDownloadOutlined />
                )
              }
              disabled={scrapeRunning}
              onClick={() => void handleRunScrape()}
            >
              {scrapeRunning ? "Scrape em execução…" : "Rodar scrape"}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <ScrapeLogPanel
        logs={scrapeLogs}
        running={scrapeRunning}
        exitCode={scrapeExitCode}
      />

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Usuários admin
          </Typography>
          {usersLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          ) : users.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nenhum usuário cadastrado.
            </Typography>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {users.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 2,
                    py: 1,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    "&:last-child": { borderBottom: 0 },
                  }}
                >
                  <Box>
                    <Typography fontWeight={600}>{item.username}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {[item.fullName, item.phone].filter(Boolean).join(" · ") ||
                        "Sem detalhes"}
                    </Typography>
                  </Box>
                  {item.username === user.username ? (
                    <Typography variant="caption" color="primary.main">
                      você
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <AddUserDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(created) => {
          setUsers((prev) => [created, ...prev]);
          setMessage({
            type: "success",
            text: `Usuário "${created.username}" criado com sucesso`,
          });
        }}
      />
    </Stack>
  );
}

export default function AdminScreen({ initialSession }: AdminScreenProps) {
  const [user, setUser] = React.useState<SessionUser | null>(initialSession);

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: 4,
        bgcolor: "background.default",
      }}
    >
      {user ? (
        <AdminPanel user={user} onLogout={() => setUser(null)} />
      ) : (
        <AdminLoginForm onSuccess={setUser} />
      )}
    </Box>
  );
}
