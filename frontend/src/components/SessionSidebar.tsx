import { useState, useRef, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Pencil, Plus, Settings, Trash2, User, Users, X } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { SessionMeta } from "@/lib/types";

interface SessionSidebarProps {
  sessions: SessionMeta[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onNavigate: (page: "profile" | "settings" | "clients") => void;
  activePage: string;
}

function timeAgo(isoDate: string): string {
  try {
    return formatDistanceToNow(new Date(isoDate), { addSuffix: true });
  } catch {
    return isoDate;
  }
}

function sessionDisplayName(session: SessionMeta): string {
  return session.display_name || session.form_title || "Untitled Session";
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onNavigate,
  activePage,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (session: SessionMeta) => {
    setEditingId(session.id);
    setEditValue(sessionDisplayName(session));
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRenameSession(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
  };

  return (
    <Sidebar>
      <SidebarHeader className="!p-0 !pl-5 !flex-row !gap-0 items-center h-12 border-b border-foreground/8">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          AutoApprops
        </span>
      </SidebarHeader>

      <SidebarContent>
        <div className="px-3 pt-3">
          <button
            onClick={onNewSession}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-foreground/12 text-sm font-medium text-foreground/50 hover:text-foreground/70 hover:border-foreground/20 hover:bg-foreground/[0.02] transition-all duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            New Session
          </button>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/30">
            Session History
          </SidebarGroupLabel>
          <SidebarMenu>
            {sessions.length === 0 && (
              <p className="px-3 py-4 text-xs text-foreground/30 leading-relaxed">
                No sessions yet. Process a form to get started.
              </p>
            )}
            {sessions.map((session) => (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  isActive={currentSessionId === session.id}
                  onClick={() => {
                    if (editingId !== session.id) {
                      onSelectSession(session.id);
                    }
                  }}
                  className="h-auto py-2.5 items-start"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    {editingId === session.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") cancelRename();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-sm font-medium bg-background border border-foreground/15 rounded px-1.5 py-0.5 outline-none focus:border-foreground/30"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            commitRename();
                          }}
                          className="text-foreground/40 hover:text-emerald-600 transition-colors p-0.5"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelRename();
                          }}
                          className="text-foreground/40 hover:text-rose-500 transition-colors p-0.5"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-medium truncate leading-tight">
                        {sessionDisplayName(session)}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-foreground/30">
                        {timeAgo(session.created_at)}
                      </span>
                      {editingId !== session.id && (
                        <div className="flex items-center gap-0.5">
                          {confirmDeleteId === session.id ? (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteSession(session.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="text-[10px] font-medium text-rose-600 hover:text-rose-700 transition-colors px-1"
                              >
                                Delete
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(null);
                                }}
                                className="text-foreground/30 hover:text-foreground/50 transition-colors p-0.5"
                                title="Cancel"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startRename(session);
                                }}
                                className="text-foreground/15 hover:text-foreground/50 transition-colors p-0.5"
                                title="Rename session"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(session.id);
                                }}
                                className="text-foreground/15 hover:text-rose-500 transition-colors p-0.5"
                                title="Delete session"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-foreground/8">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activePage === "clients"}
              onClick={() => onNavigate("clients")}
            >
              <Users className="h-4 w-4" />
              Clients
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activePage === "profile"}
              onClick={() => onNavigate("profile")}
            >
              <User className="h-4 w-4" />
              Profile
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={activePage === "settings"}
              onClick={() => onNavigate("settings")}
            >
              <Settings className="h-4 w-4" />
              Settings
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
