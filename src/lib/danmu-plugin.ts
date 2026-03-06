// Minimal "plugin" implementation to replace ArtPlayer's danmuku plugin.
// The rest of the system depends on an object with load/show/hide/reset methods
// as well as state flags (isHide/isStop/option) and a worker property.

export interface DanmuPlugin {
  load: (data?: any[]) => void;
  show: () => void;
  hide: () => void;
  reset: () => void;
  emit?: (item: any) => void; // added for compatibility with legacy code
  isHide: boolean;
  isStop: boolean;
  option: Record<string, any>;
  worker: any;
}

export default function createDanmuPlugin(container: HTMLElement): DanmuPlugin {
  let currentData: any[] = [];
  let visible = true;
  let stopped = false;

  // placeholder for worker (some existing logic may terminate it)
  const worker = null;

  function render() {
    // TODO: implement actual rendering logic, left as exercise.
    // For now we just log and skip drawing so the system remains functional.
    if (!visible) return;
    // The real implementation would draw danmaku on a canvas overlay.
    console.log('danmu render', currentData.length, 'items');
  }

  return {
    load(data = []) {
      currentData = data;
      render();
    },
    show() {
      visible = true;
      render();
    },
    hide() {
      visible = false;
      // might clear overlay
    },
    reset() {
      currentData = [];
      // clear overlay
    },
    // simple emit stub: push to currentData and render
    emit(item: any) {
      currentData.push(item);
      render();
    },
    isHide: !visible,
    isStop: stopped,
    option: {},
    worker,
  };
}
