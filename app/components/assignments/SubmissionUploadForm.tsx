
type Props = {
    submission: boolean;
    selectedFile: File | null;
    submitting: boolean;
    message: string;
    disabled?: boolean;
    disabledMessage?: string;
    onFileChange: (file: File | null) => void;
    onSubmit: () => void;
};

export default function SubmissionUploadForm({
    submission,
    selectedFile,
    submitting,
    message,
    disabled = false,
    disabledMessage,
    onFileChange,
    onSubmit,
}: Props) {
    return (
        <div
            className={`mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900 ${
                disabled ? "opacity-50" : ""
            }`}
        >
            <div className="flex flex-col gap-4">
                <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">
                    {submission
                        ? "Submit a new version"
                        : "Submit your assignment"}
                </h2>

                {disabled && disabledMessage && (
                    <p className="rounded-lg bg-gray-100 p-3 text-sm text-gray-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {disabledMessage}
                    </p>
                )}

                <div>
                    <input
                        id="assignment-file"
                        type="file"
                        accept=".pdf,.docx,.jpg,.jpeg,.png"
                        disabled={disabled || submitting}
                        onChange={(event) =>
                            onFileChange(event.target.files?.[0] ?? null)
                        }
                        className="hidden"
                    />

                    <label
                        htmlFor="assignment-file"
                        className={`inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-800 transition dark:bg-zinc-800 dark:text-white ${
                            disabled
                                ? "cursor-not-allowed"
                                : "cursor-pointer hover:bg-gray-200 dark:hover:bg-zinc-700"
                        }`}
                    >
                        Choose File
                    </label>

                    {selectedFile ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="break-all text-sm text-gray-700 dark:text-zinc-300">
                                {selectedFile.name}
                            </span>

                            <button
                                type="button"
                                disabled={disabled || submitting}
                                onClick={() => {
                                    onFileChange(null);

                                    const fileInput = document.getElementById(
                                        "assignment-file"
                                    ) as HTMLInputElement | null;

                                    if (fileInput) {
                                        fileInput.value = "";
                                    }
                                }}
                                className="text-sm font-medium text-red-600 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Remove
                            </button>
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                            PDF, DOCX, JPG, or PNG
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={disabled || !selectedFile || submitting}
                    className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {submitting
                        ? "Submitting..."
                        : submission
                            ? "Replace submission"
                            : "Submit assignment"}
                </button>

                {message && (
                    <p className="mt-3 text-sm text-gray-600 dark:text-zinc-300">
                        {message}
                    </p>
                )}
            </div>
        </div>
    );
}
