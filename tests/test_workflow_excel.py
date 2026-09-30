import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'workflow_excel', Path(__file__).resolve().parents[1] / 'lib/workflow_excel.py'
)
excel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(excel)


class WorkbookTests(unittest.TestCase):
    def test_disabled_assertion_and_retry_report_roundtrip(self):
        with tempfile.TemporaryDirectory(prefix='laya-excel-') as directory:
            source = str(Path(directory) / '用例.xlsx')
            output = str(Path(directory) / '结果.xlsx')
            case = {
                'id': '001',
                'operation': 'form-validation',
                'steps': [
                    {'kind': 'assert-disabled', 'target': {'name': '保存\x1b[2m', 'role': 'button'}}
                ],
            }
            excel.write(
                {
                    'path': source,
                    'file': {
                        'schemaVersion': 1,
                        'generatedAt': 'test',
                        'moduleUrl': 'https://app.test/records',
                        'coverage': [],
                        'cases': [case],
                    },
                }
            )
            loaded = excel.read({'path': source})
            self.assertEqual(loaded['cases'][0], case)
            excel.results(
                {
                    'path': source,
                    'output': output,
                    'results': [
                        {
                            'id': '001',
                            'status': '失败',
                            'reason': '失败\x1b[31m',
                            'attempts': [
                                {
                                    'step': 'assert-disabled',
                                    'attempt': n,
                                    'status': '失败',
                                    'reason': '未禁用\x00',
                                }
                                for n in range(1, 4)
                            ],
                        }
                    ],
                }
            )
            book = excel.load_workbook(output)
            note = book['生成用例'].cell(2, 16).value
            self.assertIn('第3次', note)
            self.assertNotIn('\x1b', note)
            self.assertNotIn('\x00', note)
            self.assertEqual(book['生成用例'].cell(2, 11).value, 'fail')
            book.close()

    def test_unpaired_surrogates_are_cleaned_before_excel_write(self):
        with tempfile.TemporaryDirectory(prefix='laya-excel-') as directory:
            source = str(Path(directory) / 'surrogate.xlsx')
            case = {
                'id': '001',
                'operation': 'form-validation',
                'steps': [
                    {
                        'kind': 'assert-disabled',
                        'target': {'name': 'save\ud800', 'role': 'button'},
                    }
                ],
            }
            excel.write(
                {
                    'path': source,
                    'file': {
                        'schemaVersion': 1,
                        'generatedAt': 'test',
                        'moduleUrl': 'https://app.test/records',
                        'coverage': [{'reason': 'bad\udfff'}],
                        'cases': [case],
                    },
                }
            )
            loaded = excel.read({'path': source})
            name = loaded['cases'][0]['steps'][0]['target']['name']
            self.assertNotIn('\ud800', name)
            self.assertTrue(name.startswith('save'))

    def test_cli_output_is_safe_under_windows_gbk_console_encoding(self):
        with tempfile.TemporaryDirectory(prefix='laya-excel-') as directory:
            source = str(Path(directory) / 'cli.xlsx')
            case = {
                'id': '001',
                'operation': 'form-validation',
                'steps': [
                    {
                        'kind': 'assert-disabled',
                        'target': {'name': 'save\ud800', 'role': 'button'},
                    }
                ],
            }
            excel.write(
                {
                    'path': source,
                    'file': {
                        'schemaVersion': 1,
                        'generatedAt': 'test',
                        'moduleUrl': 'https://app.test/records',
                        'coverage': [],
                        'cases': [case],
                    },
                }
            )
            script = Path(excel.__file__).resolve()
            env = {**os.environ, 'PYTHONIOENCODING': 'gbk'}
            completed = subprocess.run(
                [sys.executable, str(script), 'read'],
                input=json.dumps({'path': source}),
                capture_output=True,
                text=True,
                encoding='utf-8',
                env=env,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            loaded = json.loads(completed.stdout)
            self.assertEqual(loaded['cases'][0]['id'], '001')

    def test_cli_roundtrip_preserves_chinese_under_windows_console_encoding(self):
        with tempfile.TemporaryDirectory(prefix='laya-excel-') as directory:
            source = str(Path(directory) / 'roundtrip.xlsx')
            case = {
                'id': '001',
                'operation': 'form-validation',
                'steps': [
                    {
                        'kind': 'assert-disabled',
                        'target': {'name': '\u4fdd\u5b58\u6309\u94ae', 'role': 'button'},
                    }
                ],
            }
            script = Path(excel.__file__).resolve()
            env = {**os.environ, 'PYTHONIOENCODING': 'gbk'}
            write_request = {
                'path': source,
                'file': {
                    'schemaVersion': 1,
                    'generatedAt': 'test',
                    'moduleUrl': 'https://app.test/records',
                    'coverage': [],
                    'cases': [case],
                },
            }
            written = subprocess.run(
                [sys.executable, str(script), 'write'],
                input=json.dumps(write_request, ensure_ascii=False),
                capture_output=True,
                text=True,
                encoding='utf-8',
                env=env,
                check=False,
            )
            self.assertEqual(written.returncode, 0, written.stderr)
            loaded_result = subprocess.run(
                [sys.executable, str(script), 'read'],
                input=json.dumps({'path': source}, ensure_ascii=False),
                capture_output=True,
                text=True,
                encoding='utf-8',
                env=env,
                check=False,
            )
            self.assertEqual(loaded_result.returncode, 0, loaded_result.stderr)
            loaded = json.loads(loaded_result.stdout)
            self.assertEqual(
                loaded['cases'][0]['steps'][0]['target']['name'],
                '\u4fdd\u5b58\u6309\u94ae',
            )

    def test_read_editable_reports_visible_changes_without_losing_hidden_case(self):
        with tempfile.TemporaryDirectory(prefix='laya-excel-') as directory:
            source = str(Path(directory) / 'editable.xlsx')
            case = {
                'id': '001',
                'operation': 'table',
                'steps': [{'kind': 'assert-headers', 'value': ['名称']}],
            }
            excel.write(
                {
                    'path': source,
                    'file': {
                        'schemaVersion': 1,
                        'generatedAt': 'test',
                        'moduleUrl': 'https://app.test/records',
                        'coverage': [],
                        'cases': [case],
                    },
                }
            )
            book = excel.load_workbook(source)
            book['生成用例'].cell(2, 9).value = '修改后的步骤'
            book.save(source)
            book.close()
            editable = excel.read_editable({'path': source})
            self.assertEqual(editable['rows'][0]['id'], '001')
            self.assertTrue(editable['rows'][0]['changed'])
            self.assertEqual(editable['rows'][0]['case'], case)


if __name__ == '__main__':
    unittest.main()
