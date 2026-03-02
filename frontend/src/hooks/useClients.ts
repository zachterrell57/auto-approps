import { useState, useCallback, useEffect } from "react";
import * as api from "@/lib/api";
import type { Client, ClientCreate, ClientUpdate } from "@/lib/types";

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.listClients();
        if (!cancelled) setClients(list);
      } catch {
        // silent — clients list is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const addClient = useCallback(async (data: ClientCreate) => {
    const client = await api.createClient(data);
    setClients((prev) => [...prev, client]);
    return client;
  }, []);

  const editClient = useCallback(async (id: string, data: ClientUpdate) => {
    const updated = await api.updateClient(id, data);
    setClients((prev) =>
      prev.map((c) => (c.id === id ? updated : c)),
    );
    return updated;
  }, []);

  const removeClient = useCallback(async (id: string) => {
    await api.deleteClient(id);
    setClients((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    const list = await api.listClients();
    setClients(list);
  }, []);

  return {
    clients,
    loading,
    addClient,
    editClient,
    removeClient,
    refresh,
  };
}
