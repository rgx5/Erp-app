import { create } from 'zustand'

/** Whether the server answered the last time the app asked. Every request updates it, so the screens never claim a connection that is not there. */
export const useReachability = create<{ down: boolean; since: number | null; checking: boolean }>()(() => ({ down: false, since: null, checking: false }))
export const markReachable = (): void => { if (useReachability.getState().down) useReachability.setState({ down: false, since: null }) }
export const markUnreachable = (): void => { if (!useReachability.getState().down) useReachability.setState({ down: true, since: Date.now() }) }
/** A gateway in front of the server answers 502, 503 or 504 when the server behind it is not running: that is "cannot reach", not a normal error. */
export const isGatewayDown = (status: number): boolean => status === 502 || status === 503 || status === 504
