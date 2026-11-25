import type { Room } from "@colyseus/sdk";
import { ClientMessage, ServerMessage } from "@hellovalley/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { apartmentSession } from "./apartmentSession";
import { wantedApartment } from "./apartmentConnection";
import { answerVisit, attachVisitMessages, openIntercom, ringApartment, visitSession } from "./visitSession";

/** A stand-in TownRoom: records sends and lets the test deliver server messages. */
function fakeRoom() {
  const handlers = new Map<string, (m: unknown) => void>();
  const sent: [string, unknown][] = [];
  const room = {
    connection: { isOpen: true },
    send: (type: string, payload: unknown) => sent.push([type, payload]),
    onMessage: (type: string, handler: (m: unknown) => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  };
  return { room: room as unknown as Room, sent, deliver: (type: string, m: unknown) => handlers.get(type)?.(m), handlers };
}

describe("visit session (M17)", () => {
  beforeEach(() => apartmentSession.setState({ visitHost: null }));

  it("asks the intercom who is online and rings an apartment", () => {
    const { room, sent, deliver } = fakeRoom();
    const detach = attachVisitMessages(room);
    openIntercom();
    expect(visitSession.getState()).toMatchObject({ intercomOpen: true, players: null });
    expect(sent).toEqual([[ClientMessage.IntercomList, {}]]);
    deliver(ServerMessage.IntercomList, { players: [{ sessionId: "s1", name: "Alice", apartmentId: "6D", home: true }] });
    expect(visitSession.getState().players).toHaveLength(1);
    ringApartment("s1");
    expect(sent.at(-1)).toEqual([ClientMessage.VisitRequest, { sessionId: "s1" }]);
    deliver(ServerMessage.VisitStatus, { requestId: "r1", state: "pending", ownerName: "Alice", apartmentId: "6D" });
    expect(apartmentSession.getState().visitHost).toBeNull();
    // Accepted: the host's apartment is the next one to join, and the panel closes.
    deliver(ServerMessage.VisitStatus, { requestId: "r1", state: "accepted", ownerName: "Alice", apartmentId: "6D", host: "alice" });
    expect(apartmentSession.getState().visitHost).toBe("alice");
    expect(visitSession.getState().intercomOpen).toBe(false);
    detach();
    expect(visitSession.getState().outgoing).toBeNull();
  });

  it("shows requests ringing at home until answered or closed", () => {
    const { room, sent, deliver, handlers } = fakeRoom();
    const detach = attachVisitMessages(room);
    deliver(ServerMessage.VisitIncoming, { requestId: "a", fromName: "Bob", fromApartment: "2B" });
    deliver(ServerMessage.VisitIncoming, { requestId: "b", fromName: "Carol", fromApartment: "9H" });
    expect(visitSession.getState().incoming.map((r) => r.requestId)).toEqual(["a", "b"]);
    answerVisit("a", true);
    expect(sent.at(-1)).toEqual([ClientMessage.VisitAnswer, { requestId: "a", accept: true }]);
    deliver(ServerMessage.VisitClosed, { requestId: "b" });
    expect(visitSession.getState().incoming).toEqual([]);
    detach();
    expect(handlers.size).toBe(0);
  });

  it("joins the host's apartment during a visit, else your own, only in the apartment", () => {
    expect(wantedApartment("apartment", "me", null, true)).toBe("me");
    expect(wantedApartment("apartment", "me", "alice", true)).toBe("alice");
    expect(wantedApartment("town", "me", "alice", true)).toBeNull();
    expect(wantedApartment("apartment", null, null, true)).toBeNull();
    expect(wantedApartment("apartment", "me", null, false)).toBeNull();
  });
});
