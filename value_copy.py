input_string = '''
"g5g.4xlarge" : "",
    "g5g.8xlarge" : "",
    "g5g.16xlarge" : "",
    "g5g.metal" : "",
'''

# 문자열을 줄 단위로 분리하여 리스트로 저장
lines = input_string.strip().split('\n')

# 결과를 저장할 딕셔너리 생성
output_dict = {}

# 각 줄에 대해서 처리
for line in lines:
    # 줄에서 키와 값 추출
    key, value = line.split(':')

    # 키에서 불필요한 공백 제거하고 따옴표 제거
    key = key.strip().strip('"')

    # 값을 처리하여 새로운 형식으로 저장
    value = '.' + key.split('.')[1]

    # 결과 딕셔너리에 저장
    output_dict[key] = value

# 결과 출력
for key, value in output_dict.items():
    print(f'"{key}" : "{value}",')
