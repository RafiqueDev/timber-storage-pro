import React, { useEffect, useState } from "react";
import { KeyRound, Copy, Send, Ban, Clock, ExternalLink } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { api } from "../api/client.js";
import { Card, Badge, Button, Modal, SearchInput, ConfirmDialog, useConfirm, EmptyState, ErrorState, Skeleton } from "../components/ui.jsx";

const STATUS_TONE = { active: "success", expired: "warning", revoked: "danger", none: "neutral" };
const STATUS_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked", none: "No access yet" };

function timeUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m left`;
}

export default function PartyPortalManagement() {
  const { pushToast, user } = useApp();
  const canManage = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_MANAGER";
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(null); // party_id currently generating
  const [result, setResult] = useState(null); // { party_name, username, password, link, whatsappUrl, shareMessage, expiresAt }
  const { confirmState, confirm, close } = useConfirm();

  const load = async () => {
    setError("");
    try {
      setRows(await api.partyPortalList());
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (canManage) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canManage) {
    return <EmptyState title="Administrator access required." description="Only Super Admins and Branch Managers can manage party portal access." />;
  }

  const generate = async (row) => {
    setGenerating(row.party_id);
    try {
      const data = await api.generatePartyPortalAccess(row.party_id);
      setResult({ party_name: row.party_name, ...data });
      pushToast("Portal access generated.");
      load();
    } catch (e) {
      pushToast(e.message, "error");
    } finally {
      setGenerating(null);
    }
  };

  const revoke = (row) => {
    confirm({
      title: "Revoke portal access",
      description: `Revoke ${row.party_name}'s current portal access immediately? Their link and password will stop working right away.`,
      confirmLabel: "Revoke Access",
      onConfirm: async () => {
        try {
          await api.revokePartyPortalAccess(row.party_id);
          pushToast("Portal access revoked.");
          close();
          load();
        } catch (e) {
          pushToast(e.message, "error");
          close();
        }
      },
    });
  };

  const copyMessage = () => {
    navigator.clipboard?.writeText(result.shareMessage);
    pushToast("Message copied to clipboard.");
  };

  const filtered = rows?.filter((r) => r.party_name.toLowerCase().includes(search.toLowerCase())) || null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50">Party Portal Management</h2>
        <p className="text-sm text-stone-500">
          Generate a secure, time-limited link so a party can view their own containers, invoices, and payment history —
          without needing a staff login. Each access grant is valid for 24 hours.
        </p>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search parties..." />

      {error && <ErrorState message={error} onRetry={load} />}
      {!filtered && !error && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {filtered && filtered.length === 0 && <EmptyState title="No parties found." />}

      {filtered && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((row) => {
            const status = row.access?.status || "none";
            return (
              <Card key={row.party_id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-stone-900 dark:text-stone-50">{row.party_name}</p>
                      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    </div>
                    {row.access && (
                      <p className="mt-0.5 text-xs text-stone-400">
                        Username: {row.access.username}
                        {status === "active" && (
                          <>
                            {" "}
                            · <Clock className="inline h-3 w-3" /> {timeUntil(row.access.expires_at)}
                          </>
                        )}
                        {row.access.last_accessed_at && ` · Last viewed ${new Date(row.access.last_accessed_at + "Z").toLocaleString()}`}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" onClick={() => generate(row)} loading={generating === row.party_id}>
                      <KeyRound className="h-3.5 w-3.5" /> {status === "active" ? "Regenerate" : "Generate Access"}
                    </Button>
                    {status === "active" && (
                      <Button size="sm" variant="ghost" onClick={() => revoke(row)}>
                        <Ban className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!result} onClose={() => setResult(null)} title={`Portal Access — ${result?.party_name || ""}`} size="lg">
        {result && (
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Valid for 24 hours only. Share this with {result.party_name} now — regenerating will invalidate it immediately.
            </div>
            <div className="space-y-2 rounded-xl border border-stone-200 p-4 text-sm dark:border-stone-800">
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Link</span>
                <a href={result.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-primary-600">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Username</span>
                <span className="font-mono font-semibold text-stone-800 dark:text-stone-100">{result.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Password</span>
                <span className="font-mono font-semibold text-stone-800 dark:text-stone-100">{result.password}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Expires</span>
                <span className="text-stone-700 dark:text-stone-200">{new Date(result.expiresAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyMessage}>
                <Copy className="h-4 w-4" /> Copy Message
              </Button>
              <a href={result.whatsappUrl} target="_blank" rel="noreferrer">
                <Button>
                  <Send className="h-4 w-4" /> Send via WhatsApp
                </Button>
              </a>
            </div>
            <p className="text-xs text-stone-400">
              "Send via WhatsApp" opens WhatsApp with the message pre-filled — you still choose or confirm the contact yourself.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmState.open}
        onClose={close}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
      />
    </div>
  );
}
