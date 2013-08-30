#lang racket/base
;; Seashell's Clang interface FFI bindings.
;; Copyright (C) 2013 The Seashell Maintainers.
;;
;; This program is free software: you can redistribute it and/or modify
;; it under the terms of the GNU General Public License as published by
;; the Free Software Foundation, either version 3 of the License, or
;; (at your option) any later version.
;;
;; See also 'ADDITIONAL TERMS' at the end of the included LICENSE file.
;;
;; This program is distributed in the hope that it will be useful,
;; but WITHOUT ANY WARRANTY; without even the implied warranty of
;; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
;; GNU General Public License for more details.
;;
;; You should have received a copy of the GNU General Public License
;; along with this program.  If not, see <http://www.gnu.org/licenses/>.
(require ffi/unsafe
         ffi/unsafe/define
         ffi/unsafe/alloc
         ffi/unsafe/custodian)

(provide seashell_compiler_free
         seashell_compiler_make
         seashell_compiler_add_file
         seashell_compiler_clear_files
         seashell_compiler_add_compile_flag
         seashell_compiler_clear_compile_flags
         seashell_compiler_add_link_flag
         seashell_compiler_clear_link_flags
         seashell_compiler_get_linker_messages
         seashell_compiler_get_diagnostic_count
         seashell_compiler_get_diagnostic_line
         seashell_compiler_get_diagnostic_column
         seashell_compiler_get_diagnostic_file
         seashell_compiler_get_diagnostic_message
         seashell_compiler_run
         seashell_compiler_get_executable)

(define-ffi-definer define-clang (ffi-lib "libseashell-clang"))

(define _seashell_compiler-ptr (_cpointer 'seashell_compiler))

(define-clang seashell_llvm_setup (_fun -> _void))

(define-clang seashell_llvm_cleanup (_fun -> _void))

(define-clang seashell_compiler_free (_fun _seashell_compiler-ptr -> _void)
              #:wrap (deallocator))

(define-clang seashell_compiler_make (_fun -> _seashell_compiler-ptr)
              #:wrap (allocator seashell_compiler_free))

(define-clang seashell_compiler_add_file
              (_fun _seashell_compiler-ptr _string/utf-8 -> _void))

(define-clang seashell_compiler_clear_files
              (_fun _seashell_compiler-ptr -> _void))

(define-clang seashell_compiler_add_compile_flag
              (_fun _seashell_compiler-ptr _string/utf-8 -> _void))

(define-clang seashell_compiler_clear_compile_flags
              (_fun _seashell_compiler-ptr -> _void))

(define-clang seashell_compiler_add_link_flag
              (_fun _seashell_compiler-ptr _string/utf-8 -> _void))

(define-clang seashell_compiler_clear_link_flags
              (_fun _seashell_compiler-ptr -> _void))

(define-clang seashell_compiler_get_linker_messages
              (_fun _seashell_compiler-ptr -> _string/utf-8))

(define-clang seashell_compiler_get_diagnostic_count
              (_fun _seashell_compiler-ptr _int -> _int))

(define-clang seashell_compiler_get_diagnostic_line
              (_fun _seashell_compiler-ptr _int _int -> _int))

(define-clang seashell_compiler_get_diagnostic_column
              (_fun _seashell_compiler-ptr _int _int -> _int))

(define-clang seashell_compiler_get_diagnostic_file
              (_fun _seashell_compiler-ptr _int _int -> _string/utf-8))

(define-clang seashell_compiler_get_diagnostic_message
              (_fun _seashell_compiler-ptr _int _int -> _string/utf-8))

(define-clang seashell_compiler_run
              (_fun _seashell_compiler-ptr -> _int))

(define-clang seashell_compiler_get_executable
              (_fun _seashell_compiler-ptr (o : (_ptr o _int)) -> (r : _pointer) -> (values o r))
              #:wrap
              (lambda(proc)
                (lambda(comp)
                  (let-values (((size address) (proc comp)))
                    (if address
                      (make-sized-byte-string
                        (malloc size _bytes address 'nonatomic)
                        size)
                      #f)))))

(void
  (register-custodian-shutdown
    (void)
    (lambda(v) (seashell_llvm_cleanup))
    (current-custodian)
    #:at-exit? #t))

(void (seashell_llvm_setup))