import { formatDistanceToNow } from "date-fns";
import { Plus, Settings, Trash2, User } from "lucide-react";
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
  onNavigate: (page: "profile" | "settings") => void;
  activePage: string;
}

function timeAgo(isoDate: string): string {
  try {
    return formatDistanceToNow(new Date(isoDate), { addSuffix: true });
  } catch {
    return isoDate;
  }
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onNavigate,
  activePage,
}: SessionSidebarProps) {
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
                  onClick={() => onSelectSession(session.id)}
                  className="h-auto py-2.5 items-start"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium truncate leading-tight">
                      {session.form_title || "Untitled Form"}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-foreground/30">
                        {timeAgo(session.created_at)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="text-foreground/15 hover:text-rose-500 transition-colors p-0.5"
                        title="Delete session"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
