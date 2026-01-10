;; Flash Receiver Trait
;; Defines the interface that all flash loan receivers must implement

(define-trait flash-receiver-trait
  (
    ;; Execute flash loan callback
    ;; Must repay loan + fee by end of transaction
    (execute-flash (uint principal) (response bool uint))
  )
)
