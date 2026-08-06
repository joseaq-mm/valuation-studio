import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Users, Lock, Plus, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { communityGroups, communityCreateGroup, communityJoinGroup, communityLeaveGroup } from "@/lib/api";
import Forum from "./Forum";

function apiErr(e, f) { return e?.response?.data?.detail || f; }

export default function Groups({ isAdmin, onChanged }) {
    const [groups, setGroups] = useState(null);
    const [active, setActive] = useState(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [desc, setDesc] = useState("");
    const [vis, setVis] = useState("public");

    const load = useCallback(async () => {
        try { const r = await communityGroups(); setGroups(r.groups || []); }
        catch { setGroups([]); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const create = async () => {
        if (!name.trim()) { toast.error("Nombre requerido"); return; }
        try {
            await communityCreateGroup({ name: name.trim(), description: desc.trim(), visibility: vis });
            toast.success("Grupo creado");
            setName(""); setDesc(""); setVis("public"); setCreating(false); load();
        } catch (e) { toast.error(apiErr(e, "Error")); }
    };

    const join = async (g) => {
        try { await communityJoinGroup(g.id); toast.success("Te has unido"); load(); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };
    const leave = async (g) => {
        try { await communityLeaveGroup(g.id); load(); }
        catch (e) { toast.error(apiErr(e, "Error")); }
    };

    if (active) {
        return (
            <div>
                <button onClick={() => { setActive(null); load(); }} className="flex items-center gap-1 text-sm mb-3 hover:underline" data-testid="group-back"><ChevronLeft size={16} /> Grupos</button>
                <div className="flex items-center gap-2 mb-3">
                    {active.visibility === "private" ? <Lock size={16} /> : <Users size={16} />}
                    <h2 className="font-serif text-2xl">{active.name}</h2>
                </div>
                <Forum scope="group" groupId={active.id} onChanged={onChanged} />
            </div>
        );
    }

    return (
        <div data-testid="community-groups">
            {isAdmin && (
                <div className="mb-4">
                    <button onClick={() => setCreating((c) => !c)} className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs" data-testid="group-new-btn">
                        <Plus size={14} /> {creating ? "Cancelar" : "Crear grupo"}
                    </button>
                    {creating && (
                        <div className="border border-black bg-white p-3 mt-2 space-y-2" data-testid="group-form">
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del grupo" className="w-full border border-black px-3 py-2 text-sm outline-none" data-testid="group-name" />
                            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción (opcional)" className="w-full border border-black px-3 py-2 text-sm outline-none" data-testid="group-desc" />
                            <div className="flex items-center gap-2">
                                <select value={vis} onChange={(e) => setVis(e.target.value)} className="border border-black px-2 py-1.5 text-sm bg-white" data-testid="group-visibility">
                                    <option value="public">Público (cualquiera entra)</option>
                                    <option value="private">Privado (por invitación)</option>
                                </select>
                                <button onClick={create} className="btn-primary !px-4 !py-1.5 text-xs" data-testid="group-create-submit">Crear</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {groups === null ? <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto" /></div>
                : !groups.length ? <div className="py-10 text-center text-sm text-[#4A4A4A]" data-testid="groups-empty">Todavía no hay grupos.</div>
                : <div className="grid sm:grid-cols-2 gap-3" data-testid="groups-list">
                    {groups.map((g) => (
                        <div key={g.id} className="border border-black bg-white p-3" data-testid={`group-${g.id}`}>
                            <div className="flex items-center gap-2">
                                {g.visibility === "private" ? <Lock size={15} /> : <Users size={15} />}
                                <button onClick={() => setActive(g)} className="font-serif text-lg hover:underline text-left" data-testid={`group-open-${g.id}`}>{g.name}</button>
                            </div>
                            {g.description && <p className="text-sm text-[#4A4A4A] mt-1">{g.description}</p>}
                            <div className="flex items-center justify-between mt-2 text-xs text-[#4A4A4A]">
                                <span>{g.member_count} miembro{g.member_count !== 1 ? "s" : ""}</span>
                                {g.is_member
                                    ? <button onClick={() => leave(g)} className="border border-black/30 px-2 py-1 hover:border-black" data-testid={`group-leave-${g.id}`}>Salir</button>
                                    : g.visibility === "public"
                                        ? <button onClick={() => join(g)} className="btn-primary !px-2 !py-1" data-testid={`group-join-${g.id}`}>Unirse</button>
                                        : <span className="italic">Privado</span>}
                            </div>
                        </div>
                    ))}
                </div>}
        </div>
    );
}
