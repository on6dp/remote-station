! omp_lib.f90 — remplace le module OpenMP : les décodeurs compilés ici tournent sur un seul fil.
module omp_lib
  implicit none
contains
  integer function omp_get_thread_num()
    omp_get_thread_num = 0
  end function omp_get_thread_num
  integer function omp_get_num_threads()
    omp_get_num_threads = 1
  end function omp_get_num_threads
  integer function omp_get_max_threads()
    omp_get_max_threads = 1
  end function omp_get_max_threads
  subroutine omp_set_num_threads(n)
    integer, intent(in) :: n
    if (n < 0) return
  end subroutine omp_set_num_threads
end module omp_lib
