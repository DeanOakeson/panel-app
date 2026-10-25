
type Props = {
    submission: boolean;
    selectedFile: File | null;
    submitting: boolean;
    message: string;
    onFileChange: (file: File | null) => void;
    onSubmit: () => void;
};

export default function SubmissionUploadForm({
    submission,
    selectedFile,
    submitting,
    message,
    onFileChange,
    onSubmit,
}: Props) {
    return (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-gray-900">
            <div className="flex flex-col gap-4">
                <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">
                    {submission
                        ? "Submit a new version"
                        : "Submit your assignment"}
                </h2>

                <div>
                    <input
                        id="assignment-file"
                        type="file"
                        accept=".pdf,.docx,.jpg,.jpeg,.png"
                        onChange={(event) =>
                            onFileChange(event.target.files?.[0] ?? null)
                        }
                        className="hidden"
                    />

                    <label
                        htmlFor="assignment-file"
                        className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-200 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M12 16V4" />
                            <path d="m7 9 5-5 5 5" />
                            <path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" />
                        </svg>

                        Choose File
                    </label>

                    {selectedFile ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="shrink-0 text-green-600"
                            >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8" />
                                <path d="M14 2v6h6" />
                                <path d="m16 19 2 2 4-4" />
                            </svg>

                            <span className="break-all text-sm text-gray-700 dark:text-zinc-300">
                                {selectedFile.name}
                            </span>

                            <button
                                type="button"
                                onClick={() => {
                                    onFileChange(null);

                                    const fileInput = document.getElementById(
                                        "assignment-file"
                                    ) as HTMLInputElement | null;

                                    if (fileInput) {
                                        fileInput.value = "";
                                    }
                                }}
                                className="text-sm font-medium text-red-600 hover:text-red-500"
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
                    disabled={!selectedFile || submitting}
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
