import { ClassicShell } from './ClassicShell'
import { CommandShell } from './CommandShell'
import { useLayout } from './layout'

/** The app frame, in whichever layout the person chose under My account. */
export function Shell() {
  return useLayout((s) => s.layout) === 'command' ? <CommandShell /> : <ClassicShell />
}
