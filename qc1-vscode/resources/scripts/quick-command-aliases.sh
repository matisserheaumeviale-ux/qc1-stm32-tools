# QC1 aliases / functions

unalias qc1 2>/dev/null

qc1() {
  ./scripts/quick-command "$@"
}

alias qcm='qc1 make'
alias qct='qc1 tsmake'
alias qch='qc1 health'
alias qcs='qc1 status'
alias qce='qc1 error'
alias qcf='qc1 flash'
alias qcr='qc1 run'
alias qcd='qc1 ds'