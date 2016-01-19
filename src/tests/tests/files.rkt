#lang racket

(require seashell/backend/project
         seashell/backend/files
         rackunit)

(define/provide-test-suite file-suite
  (test-suite "File test suite"
    #:before (thunk (new-project "test"))
    #:after (thunk (delete-project "test"))
    (test-case "Create a file"
      (new-file "test" "good.c" #"" 'raw #f)
      (check-pred file-exists? (check-and-build-path (build-project-path "test") "good.c")))

    (test-case "Read a file"
      (check-equal? (read-file "test" "good.c") #"")
      (write-file "test" "good.c" #"foobar")
      (check-equal? (read-file "test" "good.c") #"foobar"))

    (test-case "Rename a file"
      (rename-file "test" "good.c" "bad.c")
      (check-pred file-exists? (check-and-build-path (build-project-path "test") "bad.c"))
      (check-false (file-exists? (check-and-build-path (build-project-path "test") "good.c"))))
    
    (test-case "List files"
      (new-file "test" "good.c" #"" 'raw #f)
      (check-match (list-files "test") (list-no-order
        (list "default" #t _)
        (list "default/main.c" #f _)
        (list "good.c" #f _)
        (list "bad.c" #f _))))
    
    (test-case "Create a file, with a data URL"
      (new-file "test" "foo1.c" #"data:,A brief note" 'url #f)
      (check-equal? (read-file "test" "foo1.c") #"A brief note"))

    (test-case "Create a file, with a data URL (base64)"
      (new-file "test" "foo2.c" #"data:text/html;base64,VGhpcyBpcyBhIHRlc3QK" 'url #f)
      (check-equal? (read-file "test" "foo2.c") #"This is a test\n"))
    
    (test-case "Create a file, with a data URL (base64) (missing MIME)"
      (new-file "test" "foo3.c" #"data:;base64,VGhpcyBpcyBhIHRlc3QK" 'url #f)
      (check-equal? (read-file "test" "foo3.c") #"This is a test\n"))
    
    (test-case "Create a file, with a data URL (base64) (permissive)"
      (new-file "test" "foo4.c" #"data:base64,VGhpcyBpcyBhIHRlc3QK" 'url #f)
      (check-equal? (read-file "test" "foo4.c") #"This is a test\n"))

    ;; Normalizing newlines will ensure newline before EOF
    (test-case "Create a file, with a data URL and normalized newlines"
      (new-file "test" "foo5.c" #"data:,apple juice" 'url #t)
      (check-equal? (read-file "test" "foo5.c") #"apple juice\n"))

    (test-case "Create a file, with a data URL and already-normalized newlines"
      (new-file "test" "foo6.c" #"data:,apple juice\n\n" 'url #t)
      (check-equal? (read-file "test" "foo6.c") #"apple juice\n\n"))
    
    (test-case "Create a file, with a data URL and windows newlines"
      (new-file "test" "foo7.c" #"data:,apple juice\r\n" 'url #t)
      (check-equal? (read-file "test" "foo7.c") #"apple juice\n"))



    (test-case "Delete a file"
      (remove-file "test" "bad.c")
      (check-false (file-exists? (check-and-build-path (build-project-path "test") "bad.c"))))

    (test-case "Create a directory"
      (new-directory "test" "boost")
      (check-true (directory-exists? (check-and-build-path (build-project-path "test") "boost"))))

    (test-case "Delete a directory"
      (remove-directory "test" "boost")
      (check-false (directory-exists? (check-and-build-path (build-project-path "test") "boost"))))
    
    ))
