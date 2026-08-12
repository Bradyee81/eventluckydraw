import { Modal } from "./Modal";

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <h2 className={`mb-2 text-lg font-bold ${danger ? "text-[#E27676]" : ""}`}>{title}</h2>
      <p className="mb-4 text-sm text-white/70">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-white/15 px-3 py-2 text-white/70 hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-md px-3 py-2 font-semibold ${
            danger ? "bg-[#E27676] text-[#10141F]" : "bg-[#F5C518] text-[#10141F]"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
